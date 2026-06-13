const net = require('net');

const UNKNOWN = 'unknown';
const UNKNOWN_LABEL = 'Desconocido';
const UNKNOWN_DEVICE_NAME = 'Dispositivo desconocido';

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

  raw = raw.replace(/^::ffff:/i, '');
  if (raw === '::1') return '127.0.0.1';

  if (raw.startsWith('[')) {
    const bracketEnd = raw.indexOf(']');
    if (bracketEnd > 0) raw = raw.slice(1, bracketEnd);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(raw)) {
    raw = raw.replace(/:\d+$/, '');
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

function parseBrowser(userAgent, headers = {}) {
  const uaBrands = String(getHeader(headers, 'sec-ch-ua') || '');
  if (/Edg\//i.test(userAgent) || /Microsoft Edge/i.test(uaBrands)) return 'Edge';
  if (/SamsungBrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/OPR\/|Opera/i.test(userAgent) || /Opera/i.test(uaBrands)) return 'Opera';
  if (/Chrome\/|CriOS\//i.test(userAgent) || /Google Chrome|Chromium/i.test(uaBrands)) return 'Chrome';
  if (/Firefox\/|FxiOS\//i.test(userAgent) || /Firefox/i.test(uaBrands)) return 'Firefox';
  if (/Safari\//i.test(userAgent) || /Safari/i.test(uaBrands)) return 'Safari';
  return UNKNOWN_LABEL;
}

function parseOs(userAgent, headers = {}) {
  const hintedPlatform = normalizePlatform(getHeader(headers, 'sec-ch-ua-platform'));
  if (/Android/i.test(userAgent)) return 'Android';
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) return 'iOS';
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return hintedPlatform || UNKNOWN_LABEL;
}

function inferDeviceType(userAgent, headers = {}, os = null) {
  const mobileHint = normalizeHeaderValue(getHeader(headers, 'sec-ch-ua-mobile'));
  if (mobileHint === '?1' || mobileHint === '1' || mobileHint === 'true') return 'mobile';

  if (/iPad|Tablet|SM-T|Nexus 7|Nexus 10|Kindle|Silk/i.test(userAgent)) return 'tablet';
  if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Windows Phone|Mobile/i.test(userAgent)) return 'mobile';
  if (os && os !== UNKNOWN_LABEL) return 'desktop';
  return UNKNOWN;
}

function normalizeAndroidModel(model) {
  const cleanModel = normalizeHeaderValue(model);
  if (!cleanModel) return null;
  if (/^(SM-|GT-|SAMSUNG)/i.test(cleanModel)) return `Samsung ${cleanModel.replace(/^SAMSUNG\s*/i, '')}`;
  if (/^Pixel/i.test(cleanModel)) return `Google ${cleanModel}`;
  return cleanModel;
}

function extractAndroidModel(userAgent) {
  const match = userAgent.match(/Android[^;)]*;\s*([^;)]+?)\s+Build/i)
    || userAgent.match(/Android[^;)]*;\s*([^;)]+?)\)/i);
  if (!match) return null;

  const model = match[1]
    .replace(/wv$/i, '')
    .replace(/;.*$/, '')
    .trim();

  if (!model || /^(Mobile|Tablet|Linux)$/i.test(model)) return null;
  return normalizeAndroidModel(model);
}

function buildGenericDeviceName(os, deviceType) {
  if (os === 'Windows') return 'Windows PC';
  if (os === 'macOS') return 'Mac';
  if (os === 'Linux') return 'Linux PC';
  if (os === 'Android') return deviceType === 'tablet' ? 'Android Tablet' : 'Android Phone';
  if (os === 'iOS') return deviceType === 'tablet' ? 'Apple iPad' : 'Apple iPhone';
  return UNKNOWN_DEVICE_NAME;
}

function buildDeviceName(userAgent, headers = {}, os, deviceType) {
  const hintedModel = normalizeAndroidModel(getHeader(headers, 'sec-ch-ua-model'));
  if (hintedModel) {
    const hintedPlatform = normalizePlatform(getHeader(headers, 'sec-ch-ua-platform'));
    if (/^(Samsung|Google)\s/i.test(hintedModel)) return hintedModel;
    return [hintedPlatform, hintedModel].filter(Boolean).join(' ') || hintedModel;
  }

  if (/iPad/i.test(userAgent)) return 'Apple iPad';
  if (/iPhone|iPod/i.test(userAgent)) return 'Apple iPhone';

  const androidModel = extractAndroidModel(userAgent);
  if (androidModel) return androidModel;

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

  const browser = parseBrowser(ua, headers);
  const os = parseOs(ua, headers);
  const deviceType = inferDeviceType(ua, headers, os);
  const deviceName = buildDeviceName(ua, headers, os, deviceType);

  return {
    userAgent: ua || null,
    browser,
    os,
    deviceType,
    deviceName
  };
}

module.exports = {
  parseDevice,
  getClientIp,
  cleanIp,
  normalizeIp: cleanIp,
  isPrivateIp
};
