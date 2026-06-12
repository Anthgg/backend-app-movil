const net = require('net');

const UNKNOWN = 'unknown';

function cleanIp(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/^::ffff:/, '');
  if (!raw || raw.toLowerCase() === 'unknown') return null;
  const withoutPort = raw.includes(':') && raw.split(':').length === 2 ? raw.split(':')[0] : raw;
  return net.isIP(withoutPort) ? withoutPort : null;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^(fc|fd)/i.test(ip)) return true;
  return false;
}

function getClientIp(req = {}) {
  const headers = req.headers || {};
  const candidates = [
    headers['x-forwarded-for'],
    headers['x-real-ip'],
    headers['cf-connecting-ip'],
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

function parseDevice(userAgent = '') {
  const ua = String(userAgent || '').trim();
  if (!ua) {
    return {
      userAgent: null,
      browser: null,
      os: null,
      deviceType: UNKNOWN,
      deviceName: 'Dispositivo no identificado'
    };
  }

  let browser = null;
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = 'Google Chrome';
  else if (/Firefox\/|FxiOS\//i.test(ua)) browser = 'Mozilla Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Apple Safari';

  let os = null;
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/(iPhone|iPad|iPod)/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let deviceType = 'desktop';
  if (/iPad|Tablet|SM-T|Nexus 7|Nexus 10/i.test(ua)) deviceType = 'tablet';
  else if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) deviceType = 'mobile';
  else if (!browser && !os) deviceType = UNKNOWN;

  const deviceName = [os, browser].filter(Boolean).join(' · ') || 'Dispositivo no identificado';

  return {
    userAgent: ua,
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
  isPrivateIp
};
