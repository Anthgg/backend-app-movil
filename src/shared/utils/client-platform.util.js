function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function valueIncludesAny(value, terms) {
  const normalized = normalizeText(value);
  return terms.some((term) => normalized.includes(term));
}

function getRequestPlatform(req) {
  return normalizeText(
    req.headers?.['x-client-platform']
    || req.headers?.['x-platform']
    || req.body?.platform
    || req.body?.platform_name
    || req.body?.device_info?.platform
  );
}

function getRequestClientType(req) {
  return normalizeText(
    req.headers?.['x-client-type']
    || req.headers?.['x-app-client']
    || req.body?.client_type
    || req.body?.clientType
    || req.body?.device_info?.clientType
  );
}

function detectClientDevice(req, registeredDevice = {}) {
  const userAgent = normalizeText(req.headers?.['user-agent']);
  const platform = getRequestPlatform(req) || normalizeText(registeredDevice.platform);
  const clientType = getRequestClientType(req);

  const explicitMobile = ['mobile', 'app', 'native', 'android', 'ios'].includes(clientType);
  const explicitWeb = ['web', 'desktop', 'browser'].includes(clientType);
  const mobilePlatform = valueIncludesAny(platform, ['android', 'ios', 'iphone', 'ipad']);
  const desktopPlatform = valueIncludesAny(platform, ['windows', 'win32', 'macos', 'mac os', 'darwin', 'linux', 'ubuntu']);
  const mobileUserAgent = valueIncludesAny(userAgent, ['android', 'iphone', 'ipad', 'ipod', 'mobile']);
  const desktopUserAgent = valueIncludesAny(userAgent, ['windows nt', 'macintosh', 'x11', 'linux x86_64']);

  let deviceType = 'unknown';
  if (explicitMobile || mobilePlatform || mobileUserAgent) {
    deviceType = 'mobile';
  } else if (explicitWeb || desktopPlatform || desktopUserAgent) {
    deviceType = 'desktop';
  }

  return {
    deviceType,
    clientType: clientType || null,
    platform: platform || null,
    userAgent: userAgent || null,
    isMobile: deviceType === 'mobile',
    isDesktop: deviceType === 'desktop'
  };
}

module.exports = {
  detectClientDevice
};
