const net = require('net');
const crypto = require('crypto');
const UAParser = require('ua-parser-js');

const UNKNOWN = 'unknown';
const UNKNOWN_LABEL = 'Desconocido';
const UNKNOWN_DEVICE_NAME = 'Dispositivo desconocido';

// Patterns that identify server/proxy User-Agents that are NOT real browsers.
const NODE_UA_PATTERNS = [
  /^node(?:\/|$|\s)/i,
  /^undici(?:\/|$|\s)/i,
  /^axios(?:\/|$|\s)/i,
  /^got(?:\/|$|\s)/i,
  /^node-fetch(?:\/|$|\s)/i,
  /^python/i,
  /^java(?:\/|$|\s)/i,
  /^curl(?:\/|$|\s)/i,
  /^wget(?:\/|$|\s)/i,
  /^okhttp(?:\/|$|\s)/i,
  /^Dart\/[\d.]+\s+\(dart:io\)/i
];

/**
 * Returns true if the given User-Agent string is a server/proxy UA
 * that should NOT be stored as the real browser UA.
 */
function isNodeUserAgent(ua) {
  if (!ua) return true;
  const clean = String(ua).trim();
  if (!clean || clean.toLowerCase() === 'unknown' || clean.toLowerCase() === 'null') return true;
  return NODE_UA_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * Resolves the real browser User-Agent from the request using this priority:
 *   1. x-original-user-agent header  (set by Next.js proxy)
 *   2. req.body.deviceInfo.userAgent  (explicitly sent by the frontend)
 *   3. user-agent header              (may be the proxy's own UA)
 *
 * If the resolved value looks like a server/proxy UA, returns null.
 */
function resolveUserAgent(req = {}) {
  const candidates = [
    req.headers?.['x-original-user-agent'],
    req.body?.deviceInfo?.userAgent,
    req.headers?.['user-agent']
  ];

  for (const candidate of candidates) {
    const ua = normalizeHeaderValue(candidate);
    if (ua && !isNodeUserAgent(ua)) {
      return ua;
    }
  }

  return null;
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return normalizeHeaderValue(value[0]);
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized === '""') return null;
  return normalized.replace(/^"|"$/g, '').trim() || null;
}

function getHeader(headers = {}, name) {
  return headers[name]
    || headers[name.toLowerCase()]
    || headers[name.toUpperCase()]
    || null;
}

function normalizePlatform(value) {
  const platform = normalizeHeaderValue(value);
  if (!platform) return null;
  if (/windows/i.test(platform)) return 'Windows';
  if (/mac\s?os|macintosh/i.test(platform)) return 'macOS';
  if (/android/i.test(platform)) return 'Android';
  if (/ios|iphone|ipad/i.test(platform)) return 'iOS';
  if (/linux/i.test(platform)) return 'Linux';
  return platform;
}

function cleanIp(value) {
  if (!value) return null;
  let raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'unknown') return null;
  if (raw.toLowerCase() === 'localhost') return '127.0.0.1';

  // Handle brackets for IPv6 with ports, e.g. [::1]:3000 -> ::1
  if (raw.startsWith('[')) {
    const bracketEnd = raw.indexOf(']');
    if (bracketEnd > 0) {
      raw = raw.slice(1, bracketEnd);
    }
  } else {
    // If it is IPv4 with port, e.g. 127.0.0.1:3000 -> 127.0.0.1
    const parts = raw.split(':');
    if (parts.length === 2 && net.isIPv4(parts[0])) {
      raw = parts[0];
    }
  }

  // Strip ::ffff: prefix if present
  raw = raw.replace(/^::ffff:/i, '');

  // Normalize local loops
  if (raw === '::1') return '127.0.0.1';

  // In case the IPv4-mapped IPv6 was inside brackets and had a port
  const parts = raw.split(':');
  if (parts.length === 2 && net.isIPv4(parts[0])) {
    raw = parts[0];
  }

  return net.isIP(raw) ? raw : null;
}

function isPrivateIp(ip) {
  const normalizedIp = cleanIp(ip);
  if (!normalizedIp) return true;
  if (normalizedIp === '127.0.0.1' || normalizedIp === '0.0.0.0') return true;
  if (normalizedIp.startsWith('10.')) return true;
  if (normalizedIp.startsWith('192.168.')) return true;
  if (normalizedIp.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedIp)) return true;
  if (/^(fc|fd|fe80)/i.test(normalizedIp)) return true;
  return false;
}

function getClientIp(req = {}) {
  const headers = req.headers || {};
  const candidates = [
    headers['cf-connecting-ip'],
    headers['CF-Connecting-IP'],
    headers['x-forwarded-for'],
    headers['X-Forwarded-For'],
    headers['x-real-ip'],
    headers['X-Real-IP'],
    req.ip,
    req.socket?.remoteAddress
  ];

  const parsed = [];
  candidates.forEach((candidate) => {
    String(candidate || '')
      .split(',')
      .map(cleanIp)
      .filter(Boolean)
      .forEach((ip) => parsed.push(ip));
  });

  return parsed.find((ip) => !isPrivateIp(ip)) || parsed[0] || null;
}

function buildGenericDeviceName(os, deviceType) {
  const cleanOs = String(os || '').trim().toLowerCase();
  const cleanType = String(deviceType || '').trim().toLowerCase();

  if (cleanOs.includes('windows')) return 'Windows PC';
  if (cleanOs.includes('mac') || cleanOs.includes('osx') || cleanOs.includes('os x')) return 'Mac';
  if (cleanOs.includes('linux') || cleanOs.includes('ubuntu') || cleanOs.includes('debian')) return 'Linux PC';
  if (cleanOs.includes('android')) return 'Android Phone';
  if (cleanOs.includes('ios') || cleanOs.includes('iphone') || cleanOs.includes('ipad') || cleanOs.includes('ipod')) {
    if (cleanType === 'tablet' || cleanOs.includes('ipad')) return 'Apple iPad';
    return 'Apple iPhone';
  }
  return UNKNOWN_DEVICE_NAME; // "Dispositivo desconocido"
}

function buildDeviceNameFromUAParser(result, os, deviceType) {
  const cleanOs = String(os || '').trim().toLowerCase();
  if (cleanOs.includes('windows')) return 'Windows PC';
  if (cleanOs.includes('mac') || cleanOs.includes('osx') || cleanOs.includes('os x')) return 'Mac';
  if (cleanOs.includes('linux')) return 'Linux PC';

  const vendor = result.device.vendor;
  const model = result.device.model;
  
  if (vendor && model) {
    const cleanVendor = String(vendor).trim();
    const cleanModel = String(model).trim();
    if (cleanVendor && cleanModel) {
      if (/^(Samsung|Google|Apple)/i.test(cleanVendor)) {
        return `${cleanVendor} ${cleanModel.replace(new RegExp(`^${cleanVendor}\\s*`, 'i'), '')}`;
      }
      return `${cleanVendor} ${cleanModel}`;
    }
  }
  
  return buildGenericDeviceName(os, deviceType);
}

function parseDevice(userAgent = '', headers = {}) {
  const ua = String(userAgent || '').trim();
  const hasHints = ['sec-ch-ua-platform', 'sec-ch-ua-mobile', 'sec-ch-ua-model', 'sec-ch-ua']
    .some((header) => normalizeHeaderValue(getHeader(headers, header)));

  if (!ua && !hasHints) {
    return {
      userAgent: null,
      browser: UNKNOWN_LABEL,
      os: UNKNOWN_LABEL,
      deviceType: UNKNOWN,
      deviceName: UNKNOWN_DEVICE_NAME
    };
  }

  // 1. Parse using ua-parser-js
  const parser = new UAParser(ua);
  const result = parser.getResult();

  // 2. Resolve browser
  let browser = result.browser.name || UNKNOWN_LABEL;
  if (browser === UNKNOWN_LABEL) {
    const uaBrands = String(getHeader(headers, 'sec-ch-ua') || '');
    if (/Microsoft Edge|Edge/i.test(uaBrands)) browser = 'Edge';
    else if (/Google Chrome|Chrome/i.test(uaBrands)) browser = 'Chrome';
    else if (/Chromium/i.test(uaBrands)) browser = 'Chrome';
    else if (/Firefox/i.test(uaBrands)) browser = 'Firefox';
    else if (/Safari/i.test(uaBrands)) browser = 'Safari';
    else if (/Opera/i.test(uaBrands)) browser = 'Opera';
  }

  // Normalize mobile prefix / other variations
  if (browser.startsWith('Mobile ')) {
    browser = browser.replace('Mobile ', '');
  }
  if (browser === 'Microsoft Edge') {
    browser = 'Edge';
  }

  // 3. Resolve OS
  let os = result.os.name || UNKNOWN_LABEL;
  if (os === UNKNOWN_LABEL) {
    const hintedPlatform = normalizePlatform(getHeader(headers, 'sec-ch-ua-platform'));
    if (hintedPlatform) os = hintedPlatform;
  }

  // 4. Resolve Device Type
  let deviceType = result.device.type || UNKNOWN;
  if (deviceType === UNKNOWN || deviceType === undefined) {
    const mobileHint = normalizeHeaderValue(getHeader(headers, 'sec-ch-ua-mobile'));
    if (mobileHint === '?1' || mobileHint === '1' || mobileHint === 'true') {
      deviceType = 'mobile';
    } else if (os && os !== UNKNOWN_LABEL) {
      deviceType = 'desktop';
    } else {
      deviceType = 'unknown';
    }
  }

  // 5. Build Device Name
  let deviceName = null;
  const hintedModel = normalizeHeaderValue(getHeader(headers, 'sec-ch-ua-model'));
  if (hintedModel) {
    const hintedPlatform = normalizePlatform(getHeader(headers, 'sec-ch-ua-platform')) || os;
    const cleanModel = hintedModel.toLowerCase();
    if (/iphone/i.test(cleanModel)) {
      deviceName = 'Apple iPhone';
    } else if (/ipad/i.test(cleanModel)) {
      deviceName = 'Apple iPad';
    } else if (/pixel/i.test(cleanModel)) {
      deviceName = `Google ${hintedModel}`;
    } else if (/^(samsung|google|apple)\s/i.test(hintedModel)) {
      deviceName = hintedModel;
    } else if (/^(sm-|gt-|samsung)/i.test(hintedModel)) {
      deviceName = `Samsung ${hintedModel.replace(/^samsung\s*/i, '')}`;
    } else {
      if (hintedPlatform && hintedPlatform !== 'Desconocido' && !cleanModel.includes(hintedPlatform.toLowerCase())) {
        deviceName = `${hintedPlatform} ${hintedModel}`;
      } else {
        deviceName = hintedModel;
      }
    }
  }

  if (!deviceName) {
    deviceName = buildDeviceNameFromUAParser(result, os, deviceType);
  }

  return {
    userAgent: ua || null,
    browser,
    os,
    deviceType,
    deviceName
  };
}

function normalizeFingerprintValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function generateDeviceFingerprint(userId, req = {}) {
  const userAgent = resolveUserAgent(req);
  const headers = req?.headers || {};
  const parsed = parseDevice(userAgent, headers);
  const deviceInfo = req.body?.deviceInfo;

  // We intentionally use generic browser name and OS name to avoid fingerprint changes on minor updates
  const fingerprintSource = [
    normalizeFingerprintValue(userId),
    normalizeFingerprintValue(parsed.browser),
    normalizeFingerprintValue(parsed.os),
    normalizeFingerprintValue(parsed.deviceType),
    normalizeFingerprintValue(parsed.deviceName),
    normalizeFingerprintValue(deviceInfo?.timezone),
    normalizeFingerprintValue(deviceInfo?.screen?.width),
    normalizeFingerprintValue(deviceInfo?.screen?.height),
    normalizeFingerprintValue(deviceInfo?.clientHints?.platform),
    normalizeFingerprintValue(deviceInfo?.clientHints?.model)
  ].join('|');

  return crypto.createHash('sha256').update(fingerprintSource).digest('hex');
}

module.exports = {
  parseDevice,
  getClientIp,
  cleanIp,
  normalizeIp: cleanIp,
  isPrivateIp,
  isNodeUserAgent,
  resolveUserAgent,
  generateDeviceFingerprint
};
