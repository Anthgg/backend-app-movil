const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const { getClientIp, parseDevice, resolveUserAgent } = require('../../shared/utils/device-parser');
const { resolveIpLocation } = require('../../shared/utils/ip-geolocation');
const { isValidUUID } = require('../../utils/uuid.util');
const { getTableColumns } = require('../../utils/db.util');

const TRUST_WAIT_DAYS = 7;
const TRUSTED_SESSION_DAYS = 30;
const DEFAULT_SESSION_DAYS = 7;
const TRUST_WAIT_INTERVAL_SQL = `${TRUST_WAIT_DAYS} days`;
let userSessionsAvailableCache = null;
let userSessionsFingerprintColumnCache = null;
let userSessionsDeviceIdColumnCache = null;
let trustedDevicesAvailableCache = null;

function isMissingSessionTable(error) {
  const message = String(error?.message || '');
  return error?.code === '42P01'
    || /relation .*user_sessions.* does not exist/i.test(message)
    || /table .*user_sessions.* does not exist/i.test(message);
}

function isMissingColumn(error, columnName) {
  const message = String(error?.message || '');
  const column = String(error?.column || '');
  return error?.code === '42703'
    && (
      !columnName
      || column.toLowerCase() === String(columnName).toLowerCase()
      || message.toLowerCase().includes(String(columnName).toLowerCase())
    );
}

async function hasUserSessionsTable() {
  if (userSessionsAvailableCache !== null) {
    return userSessionsAvailableCache;
  }

  const result = await query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_sessions'
    LIMIT 1
  `);

  userSessionsAvailableCache = result.rowCount > 0;
  return userSessionsAvailableCache;
}

async function hasUserSessionsFingerprintColumn() {
  if (userSessionsFingerprintColumnCache !== null) {
    return userSessionsFingerprintColumnCache;
  }

  if (!(await hasUserSessionsTable())) {
    userSessionsFingerprintColumnCache = false;
    return false;
  }

  const result = await query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_sessions'
      AND column_name = 'device_fingerprint'
    LIMIT 1
  `);

  if (result.rowCount > 0) {
    userSessionsFingerprintColumnCache = true;
    return true;
  }
  return false;
}

async function hasUserSessionsDeviceIdColumn() {
  if (userSessionsDeviceIdColumnCache !== null) {
    return userSessionsDeviceIdColumnCache;
  }

  if (!(await hasUserSessionsTable())) {
    userSessionsDeviceIdColumnCache = false;
    return false;
  }

  const result = await query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_sessions'
      AND column_name = 'trusted_device_id'
    LIMIT 1
  `);

  if (result.rowCount > 0) {
    userSessionsDeviceIdColumnCache = true;
    return true;
  }
  return false;
}

async function hasTrustedDevicesTable() {
  if (trustedDevicesAvailableCache !== null) {
    return trustedDevicesAvailableCache;
  }

  const result = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trusted_devices'
  `);

  const columns = new Set(result.rows.map((row) => row.column_name));
  const hasCompleteSchema = [
    'id',
    'user_id',
    'device_id',
    'device_fingerprint',
    'company_id',
    'is_trusted',
    'trusted_at',
    'trust_expires_at',
    'last_seen_at'
  ].every((column) => columns.has(column));
  if (hasCompleteSchema) {
    trustedDevicesAvailableCache = true;
  }
  return hasCompleteSchema;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isUnknownLabel(value) {
  return ['unknown', 'desconocido'].includes(String(value || '').trim().toLowerCase());
}

function isLegacyDeviceName(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'sesion activa';
}

function cleanBrowser(row) {
  const browser = cleanText(row.browser);
  if (!browser) return null;
  if (browser === row.id || isValidUUID(browser)) return null;
  return browser;
}

function cleanDeviceName(value) {
  const deviceName = cleanText(value);
  if (!deviceName) return null;
  if (isLegacyDeviceName(deviceName) || isValidUUID(deviceName)) return null;
  return deviceName;
}

function genericDeviceName(os, deviceType) {
  if (os === 'Windows') return 'Windows PC';
  if (os === 'macOS') return 'Mac';
  if (os === 'Linux') return 'Linux PC';
  if (os === 'Android') return deviceType === 'tablet' ? 'Android Tablet' : 'Android Phone';
  if (os === 'iOS') return deviceType === 'tablet' ? 'Apple iPad' : 'Apple iPhone';
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function getRequestDeviceInfo(req = {}) {
  return {
    ...(req.body?.deviceInfo || {}),
    ...(req.body?.device_info || {}),
    ...(req.body?.deviceContext || {}),
    ...(req.body?.device_context || {})
  };
}

function normalizeSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (['mobile', 'mobile_app', 'app', 'native', 'android', 'ios'].includes(source)) return 'mobile_app';
  if (['web', 'browser', 'desktop'].includes(source)) return 'web';
  return null;
}

function normalizeDeviceType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (['mobile', 'phone', 'android', 'ios', 'iphone'].includes(type)) return 'mobile';
  if (['tablet', 'ipad'].includes(type)) return 'tablet';
  if (['desktop', 'web', 'browser', 'pc'].includes(type)) return 'desktop';
  return type || null;
}

function inferSource(req = {}, parsed = {}) {
  const info = getRequestDeviceInfo(req);
  const explicit = normalizeSource(
    req.headers?.['x-client-type']
    || req.headers?.['x-app-client']
    || info.source
    || info.clientType
    || info.client_type
    || req.body?.source
    || req.body?.clientType
    || req.body?.client_type
  );
  if (explicit) return explicit;

  const path = String(req.originalUrl || req.url || '').toLowerCase();
  if (path.includes('/api/mobile/')) return 'mobile_app';

  const platform = String(
    req.headers?.['x-client-platform']
    || req.headers?.['x-platform']
    || info.platform
    || req.body?.platform
    || ''
  ).toLowerCase();

  if (/android|ios|iphone|ipad/.test(platform)) return 'mobile_app';
  if (info.appVersion || info.app_version || req.body?.appVersion || req.body?.app_version) return 'mobile_app';
  if (['mobile', 'tablet'].includes(parsed.deviceType)) return 'mobile_app';
  return 'web';
}

function normalizePlatform(value, source, os) {
  const platform = cleanText(value);
  if (platform) {
    if (/android/i.test(platform)) return 'android';
    if (/ios|iphone|ipad/i.test(platform)) return 'ios';
    if (/browser|web/i.test(platform)) return 'browser';
    if (/windows/i.test(platform)) return 'windows';
    if (/mac/i.test(platform)) return 'macos';
    return platform.toLowerCase();
  }

  if (source === 'mobile_app') {
    if (/android/i.test(os || '')) return 'android';
    if (/ios|iphone|ipad/i.test(os || '')) return 'ios';
    return null;
  }

  return 'browser';
}

function normalizeOsDisplay(value) {
  const os = cleanText(value);
  if (!os) return null;
  if (/android/i.test(os)) return 'Android';
  if (/ios|iphone|ipad/i.test(os)) return 'iOS';
  if (/windows/i.test(os)) return 'Windows';
  if (/mac\s?os|macintosh|darwin/i.test(os)) return 'macOS';
  if (/linux/i.test(os)) return 'Linux';
  return os;
}

function buildDeviceNameFallback({ deviceName, browser, os, deviceType, source }) {
  const cleanName = cleanDeviceName(deviceName);
  if (cleanName && cleanName !== 'Dispositivo desconocido') return cleanName;
  if (browser && os) return `${browser} en ${os}`;
  if (deviceType && deviceType !== 'unknown' && os) return `${deviceType} - ${os}`;
  if (source === 'mobile_app') return 'App movil';
  if (source === 'web') return 'Dispositivo web';
  return null;
}

function buildSessionContext(req = {}, parsed = {}, geo = {}) {
  const info = getRequestDeviceInfo(req);
  const source = inferSource(req, parsed);
  const platform = normalizePlatform(
    req.headers?.['x-client-platform']
      || req.headers?.['x-platform']
      || info.platform
      || req.body?.platform
      || req.body?.platform_name,
    source,
    parsed.os
  );
  const mobileOs = firstText(info.os, info.osName, info.operatingSystem, info.platform, req.body?.os, req.body?.platform);
  const os = normalizeOsDisplay(source === 'mobile_app'
    ? firstText(mobileOs, parsed.os && !isUnknownLabel(parsed.os) ? parsed.os : null)
    : firstText(parsed.os && !isUnknownLabel(parsed.os) ? parsed.os : null, mobileOs));
  const browser = source === 'mobile_app'
    ? (parsed.browser && !isUnknownLabel(parsed.browser) ? parsed.browser : null)
    : (parsed.browser && !isUnknownLabel(parsed.browser) ? parsed.browser : null);
  const rawDeviceType = firstText(info.deviceType, info.device_type, req.body?.deviceType, req.body?.device_type, parsed.deviceType);
  const deviceType = normalizeDeviceType(rawDeviceType)
    || (source === 'mobile_app' ? 'mobile' : 'desktop');
  const manufacturer = firstText(info.manufacturer, info.brand, req.body?.manufacturer, req.body?.brand);
  const model = firstText(info.deviceModel, info.device_model, info.model, req.body?.deviceModel, req.body?.device_model, req.body?.model, parsed.deviceModel);
  const explicitDeviceName = firstText(
    info.deviceName,
    info.device_name,
    info.name,
    req.body?.deviceName,
    req.body?.device_name,
    manufacturer && model ? `${manufacturer} ${model}` : null,
    model
  );
  const parsedDeviceName = parsed.deviceName && parsed.deviceName !== 'Dispositivo desconocido'
    ? parsed.deviceName
    : null;
  const deviceName = buildDeviceNameFallback({
    deviceName: explicitDeviceName || parsedDeviceName,
    browser,
    os,
    deviceType,
    source
  });

  return {
    userAgent: parsed.userAgent || null,
    source,
    platform,
    browser,
    browserVersion: firstText(parsed.browserVersion, info.browserVersion, info.browser_version, req.body?.browserVersion, req.body?.browser_version),
    os,
    osVersion: firstText(info.osVersion, info.os_version, info.sdkVersion, info.androidVersion, req.body?.osVersion, req.body?.os_version, parsed.osVersion),
    deviceType,
    deviceName,
    deviceModel: model,
    appVersion: firstText(info.appVersion, info.app_version, req.body?.appVersion, req.body?.app_version),
    timezone: firstText(info.timezone, req.body?.timezone, geo.timezone)
  };
}

function isDeviceTrustActive(device) {
  if (!device || device.revoked_at || device.is_trusted !== true) return false;
  if (!device.trust_expires_at) return true;
  return new Date(device.trust_expires_at) > new Date();
}

function getDeviceTrustFields(row) {
  const deviceTrustActive = isDeviceTrustActive({
    is_trusted: row.device_is_trusted,
    trust_expires_at: row.device_trust_expires_at,
    revoked_at: row.device_revoked_at
  });
  const sessionTrustActive = row.is_trusted === true;
  const isTrusted = deviceTrustActive || sessionTrustActive;

  return {
    isTrusted,
    trustedAt: row.device_trusted_at || row.trusted_at || null,
    trustExpiresAt: row.device_trust_expires_at || null
  };
}

function mapSession(row, currentSessionId = null) {
  if (!row) return null;
  const inferred = row.user_agent ? parseDevice(row.user_agent) : null;
  const source = normalizeSource(row.source)
    || (String(row.platform || '').toLowerCase().match(/android|ios|iphone|ipad/) ? 'mobile_app' : 'web');
  const browser = cleanBrowser(row)
    || (!isUnknownLabel(inferred?.browser) ? inferred?.browser : null)
    || null;
  const os = normalizeOsDisplay(cleanText(row.os))
    || normalizeOsDisplay(!isUnknownLabel(inferred?.os) ? inferred?.os : null)
    || null;
  const storedDeviceType = cleanText(row.device_type);
  const deviceType = storedDeviceType && storedDeviceType !== 'unknown'
    ? storedDeviceType
    : (inferred?.deviceType && inferred.deviceType !== 'unknown'
      ? inferred.deviceType
      : (source === 'mobile_app' ? 'mobile' : (storedDeviceType || 'unknown')));
  const inferredDeviceName = inferred?.deviceName && inferred.deviceName !== 'Dispositivo desconocido'
    ? inferred.deviceName
    : null;
  const deviceName = buildDeviceNameFallback({
    deviceName: cleanDeviceName(row.device_name) || inferredDeviceName || genericDeviceName(os, deviceType),
    browser,
    os,
    deviceType,
    source
  });
  const trustAvailableAt = row.trust_available_at
    || (row.created_at ? new Date(new Date(row.created_at).getTime() + TRUST_WAIT_DAYS * 24 * 60 * 60 * 1000) : null);
  const { isTrusted, trustedAt, trustExpiresAt } = getDeviceTrustFields(row);
  const isCurrent = currentSessionId && row.id === currentSessionId;
  const canTrust = !isTrusted && trustAvailableAt && trustAvailableAt <= new Date();

  const isLegacy = !row.user_agent && !row.ip_address;

  return {
    id: row.id,
    userId: row.user_id || null,
    workerId: row.worker_id || null,
    companyId: row.company_id || null,
    source,
    platform: row.platform || (source === 'web' ? 'browser' : null),
    appVersion: row.app_version || null,
    userAgent: row.user_agent || null,
    location: row.location || null,
    country: row.country || null,
    region: row.region || null,
    city: row.city || null,
    timezone: row.timezone || null,
    latitude: row.latitude !== undefined && row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== undefined && row.longitude !== null ? Number(row.longitude) : null,
    browser,
    browserVersion: row.browser_version || inferred?.browserVersion || null,
    os,
    osVersion: row.os_version || inferred?.osVersion || null,
    deviceType,
    deviceName,
    deviceModel: row.device_model || inferred?.deviceModel || null,
    deviceId: row.resolved_trusted_device_id
      || row.trusted_device_id
      || row.device_id
      || row.resolved_device_fingerprint
      || row.device_fingerprint
      || null,
    ipAddress: row.ip_address || null,
    isTrusted,
    trustedAt: toIso(trustedAt),
    trustExpiresAt: toIso(trustExpiresAt),
    createdAt: toIso(row.created_at),
    lastActivityAt: toIso(row.last_activity_at),
    expiresAt: toIso(row.expires_at),
    isCurrent: Boolean(isCurrent),
    canTrust: Boolean(canTrust),
    trustAvailableAt: toIso(trustAvailableAt),
    revokedAt: toIso(row.revoked_at),
    isLegacy
  };
}

function assertSessionId(sessionId) {
  if (!isValidUUID(sessionId)) {
    const err = new Error('Sesion invalida.');
    err.statusCode = 400;
    err.errorCode = 'INVALID_SESSION_ID';
    throw err;
  }
}

function decodeRefreshTokenSessionId(token) {
  try {
    const decoded = jwt.decode(token);
    return isValidUUID(decoded?.sessionId) ? decoded.sessionId : null;
  } catch (error) {
    return null;
  }
}

function mapLegacyRefreshTokenRows(rows, currentSessionId = null) {
  const sessionsById = new Map();

  rows.forEach((row) => {
    const sessionId = decodeRefreshTokenSessionId(row.token) || row.refresh_token_id || row.id;
    const sessionRow = {
      id: sessionId,
      user_id: row.user_id,
      user_agent: null,
      location: null,
      country: null,
      city: null,
      latitude: null,
      longitude: null,
      browser: null,
      os: null,
      device_type: 'unknown',
      device_name: null,
      ip_address: null,
      is_trusted: false,
      trust_available_at: null,
      trusted_at: null,
      created_at: row.created_at,
      last_activity_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: null
    };

    const existing = sessionsById.get(sessionId);
    if (!existing || new Date(sessionRow.created_at) > new Date(existing.created_at)) {
      sessionsById.set(sessionId, sessionRow);
    }
  });

  return Array.from(sessionsById.values()).map((row) => mapSession(row, currentSessionId));
}

async function revokeOtherRefreshTokens(client, userId, currentSessionId, alreadyRevokedTokenIds = []) {
  if (!currentSessionId) {
    return { tokenCount: 0, tokenIds: [] };
  }

  const existingRevoked = new Set(alreadyRevokedTokenIds.filter(Boolean).map(String));
  const activeTokens = await client.query(`
    SELECT id, token
    FROM refresh_tokens
    WHERE user_id = $1
      AND revoked = FALSE
      AND expires_at > NOW()
  `, [userId]);

  const tokenIdsToRevoke = activeTokens.rows
    .filter((row) => {
      if (existingRevoked.has(String(row.id))) return false;
      const tokenSessionId = decodeRefreshTokenSessionId(row.token);
      if (currentSessionId && tokenSessionId === currentSessionId) return false;
      return true;
    })
    .map((row) => row.id)
    .filter(Boolean);

  if (tokenIdsToRevoke.length === 0) {
    return { tokenCount: 0, tokenIds: [] };
  }

  const revoked = await client.query(`
    UPDATE refresh_tokens
    SET revoked = TRUE,
        expires_at = NOW()
    WHERE id = ANY($1::uuid[])
      AND revoked = FALSE
    RETURNING id
  `, [tokenIdsToRevoke]);

  return {
    tokenCount: revoked.rowCount || 0,
    tokenIds: revoked.rows.map((row) => row.id)
  };
}

async function upsertTrustedDevice({ userId, companyId, fingerprint, parsed, userAgent, ipAddress, geo }) {
  if (!fingerprint) return null;
  if (!(await hasTrustedDevicesTable())) return null;

  try {
    const result = await query(`
      INSERT INTO trusted_devices (
        user_id, company_id, device_id, device_fingerprint, user_agent, browser, os, device_type, device_name,
        last_ip_address, last_location, last_country, last_city, last_latitude, last_longitude,
        first_seen_at, last_seen_at, created_at, updated_at
      )
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW(),NOW(),NOW())
      ON CONFLICT (user_id, device_fingerprint) DO UPDATE
      SET company_id = COALESCE(EXCLUDED.company_id, trusted_devices.company_id),
          device_id = COALESCE(trusted_devices.device_id, EXCLUDED.device_id),
          user_agent = COALESCE(EXCLUDED.user_agent, trusted_devices.user_agent),
          browser = COALESCE(NULLIF(EXCLUDED.browser, 'Desconocido'), trusted_devices.browser),
          os = COALESCE(NULLIF(EXCLUDED.os, 'Desconocido'), trusted_devices.os),
          device_type = CASE
            WHEN EXCLUDED.device_type IS NULL OR EXCLUDED.device_type = 'unknown' THEN COALESCE(trusted_devices.device_type, 'unknown')
            ELSE EXCLUDED.device_type
          END,
          device_name = CASE
            WHEN EXCLUDED.device_name IS NULL OR EXCLUDED.device_name = 'Dispositivo desconocido' THEN COALESCE(trusted_devices.device_name, EXCLUDED.device_name)
            ELSE EXCLUDED.device_name
          END,
          last_ip_address = COALESCE(EXCLUDED.last_ip_address, trusted_devices.last_ip_address),
          last_location = COALESCE(EXCLUDED.last_location, trusted_devices.last_location),
          last_country = COALESCE(EXCLUDED.last_country, trusted_devices.last_country),
          last_city = COALESCE(EXCLUDED.last_city, trusted_devices.last_city),
          last_latitude = COALESCE(EXCLUDED.last_latitude, trusted_devices.last_latitude),
          last_longitude = COALESCE(EXCLUDED.last_longitude, trusted_devices.last_longitude),
          last_seen_at = NOW(),
          revoked_at = NULL,
          revoked_reason = NULL,
          updated_at = NOW()
      RETURNING *
    `, [
      userId,
      companyId || null,
      fingerprint,
      userAgent || null,
      parsed.browser,
      parsed.os,
      parsed.deviceType,
      parsed.deviceName,
      ipAddress,
      geo.location,
      geo.country,
      geo.city,
      geo.latitude,
      geo.longitude
    ]);

    trustedDevicesAvailableCache = true;
    return result.rows[0] || null;
  } catch (error) {
    const message = String(error?.message || '');
    if (error?.code === '42P01' || /trusted_devices/i.test(message)) {
      trustedDevicesAvailableCache = false;
      return null;
    }
    throw error;
  }
}

async function findReusableSessionId(userId, fingerprint) {
  if (!fingerprint) return null;
  if (!(await hasUserSessionsTable())) return null;
  if (!(await hasUserSessionsFingerprintColumn())) return null;

  try {
    const result = await query(`
      SELECT id
      FROM user_sessions
      WHERE user_id = $1
        AND device_fingerprint = $2
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW() - INTERVAL '15 days')
      ORDER BY
        is_trusted DESC,
        trust_available_at ASC,
        last_activity_at DESC
      LIMIT 1
    `, [userId, fingerprint]);

    return result.rows[0]?.id || null;
  } catch (error) {
    if (isMissingColumn(error, 'device_fingerprint')) {
      userSessionsFingerprintColumnCache = false;
      return null;
    }
    if (isMissingSessionTable(error)) {
      userSessionsAvailableCache = false;
      userSessionsFingerprintColumnCache = false;
      return null;
    }
    throw error;
  }
}

async function createSession({ userId, workerId = null, companyId, refreshToken, refreshTokenId, sessionId, expiresAt, req, fingerprint }) {
  if (!sessionId) return;
  if (!(await hasUserSessionsTable())) return;

  const logger = require('../../shared/utils/logger');

  // Resolve the real browser UA using the correct priority chain.
  // x-original-user-agent > body.deviceInfo.userAgent > user-agent header
  const userAgent = resolveUserAgent(req);
  const headers = req?.headers || {};

  // Dev-only debug to verify which UA source is being used
  if (process.env.NODE_ENV !== 'production') {
    logger.logInfo('SESSION', '[SESSION DEVICE DEBUG]', {
      originalUserAgent: headers['x-original-user-agent'] || null,
      bodyUserAgent: req?.body?.deviceInfo?.userAgent || null,
      headerUserAgent: headers['user-agent'] || null,
      selectedUserAgent: userAgent
    });
  }

  const parsed = parseDevice(userAgent, headers);
  const ipAddress = getClientIp(req);
  const geo = await resolveIpLocation(ipAddress);
  const context = buildSessionContext(req, parsed, geo);
  const device = await upsertTrustedDevice({
    userId,
    companyId,
    fingerprint,
    parsed: {
      ...parsed,
      browser: context.browser || parsed.browser,
      os: context.os || parsed.os,
      deviceType: context.deviceType || parsed.deviceType,
      deviceName: context.deviceName || parsed.deviceName
    },
    userAgent: context.userAgent,
    ipAddress,
    geo
  });
  const deviceTrusted = isDeviceTrustActive(device);
  const sessionTrustedAt = deviceTrusted ? device.trusted_at : null;
  const trustAvailableAt = deviceTrusted ? new Date() : null;

  console.log('[LOGIN_CONTEXT]', {
    userId,
    workerId,
    companyId,
    source: context.source,
    ipAddress,
    userAgent: context.userAgent,
    browser: context.browser,
    os: context.os,
    deviceType: context.deviceType,
    deviceName: context.deviceName,
    location: geo.location
  });

  logger.logInfo('SESSION', `[SESSION CREATED] ip=${ipAddress} browser=${context.browser} os=${context.os} deviceType=${context.deviceType} deviceName=${context.deviceName}`);

  const insertSession = async ({ includeFingerprint, includeDeviceId }) => {
    const fingerprintUpdateSql = includeFingerprint ? ',\n          device_fingerprint = EXCLUDED.device_fingerprint' : '';
    const deviceIdUpdateSql = includeDeviceId ? ',\n          trusted_device_id = COALESCE(EXCLUDED.trusted_device_id, user_sessions.trusted_device_id)' : '';
    let fingerprintColumnSql = '';
    let fingerprintValueSql = '';
    let deviceIdColumnSql = '';
    let deviceIdValueSql = '';
    const values = [
      sessionId,
      userId,
      companyId || null,
      workerId || null,
      refreshTokenId,
      hashToken(refreshToken),
      ipAddress,
      context.userAgent,
      geo.location,
      geo.country,
      geo.region,
      geo.city,
      geo.latitude,
      geo.longitude,
      context.timezone,
      context.browser,
      context.browserVersion,
      context.os,
      context.osVersion,
      context.deviceType,
      context.deviceName,
      context.deviceModel,
      context.platform,
      context.appVersion,
      context.source,
      deviceTrusted,
      sessionTrustedAt,
      trustAvailableAt,
      TRUST_WAIT_INTERVAL_SQL,
      expiresAt
    ];
    if (includeDeviceId) {
      values.push(device?.id || null);
      deviceIdColumnSql = ', trusted_device_id';
      deviceIdValueSql = `,$${values.length}`;
    }
    if (includeFingerprint) {
      values.push(fingerprint || null);
      fingerprintColumnSql = ', device_fingerprint';
      fingerprintValueSql = `,$${values.length}`;
    }

    const result = await query(`
      INSERT INTO user_sessions (
        id, user_id, company_id, worker_id, refresh_token_id, refresh_token_hash, ip_address, user_agent,
        location, country, region, city, latitude, longitude, timezone, browser, browser_version, os, os_version,
        device_type, device_name, device_model, platform, app_version, source,
        is_trusted, trusted_at, trust_available_at, last_activity_at, last_activity_update_at, expires_at, updated_at${deviceIdColumnSql}${fingerprintColumnSql}
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,COALESCE($28::timestamptz,NOW() + $29::interval),NOW(),NOW(),$30,NOW()${deviceIdValueSql}${fingerprintValueSql})
      ON CONFLICT (id) DO UPDATE
      SET company_id = COALESCE(EXCLUDED.company_id, user_sessions.company_id),
          worker_id = COALESCE(EXCLUDED.worker_id, user_sessions.worker_id),
          refresh_token_id = EXCLUDED.refresh_token_id,
          refresh_token_hash = EXCLUDED.refresh_token_hash,
          ip_address = CASE WHEN EXCLUDED.ip_address IN ('127.0.0.1', '::1', '::ffff:127.0.0.1') THEN user_sessions.ip_address ELSE COALESCE(EXCLUDED.ip_address, user_sessions.ip_address) END,
          user_agent = COALESCE(EXCLUDED.user_agent, user_sessions.user_agent),
          location = COALESCE(EXCLUDED.location, user_sessions.location),
          country = COALESCE(EXCLUDED.country, user_sessions.country),
          region = COALESCE(EXCLUDED.region, user_sessions.region),
          city = COALESCE(EXCLUDED.city, user_sessions.city),
          latitude = COALESCE(EXCLUDED.latitude, user_sessions.latitude),
          longitude = COALESCE(EXCLUDED.longitude, user_sessions.longitude),
          timezone = COALESCE(EXCLUDED.timezone, user_sessions.timezone),
          browser = COALESCE(EXCLUDED.browser, user_sessions.browser),
          browser_version = COALESCE(EXCLUDED.browser_version, user_sessions.browser_version),
          os = COALESCE(EXCLUDED.os, user_sessions.os),
          os_version = COALESCE(EXCLUDED.os_version, user_sessions.os_version),
          device_type = CASE WHEN EXCLUDED.device_type IN ('unknown', 'Desconocido') THEN user_sessions.device_type ELSE COALESCE(EXCLUDED.device_type, user_sessions.device_type) END,
          device_name = CASE WHEN EXCLUDED.device_name IN ('Dispositivo desconocido', 'Sesion antigua', 'Dispositivo web', 'App movil') THEN user_sessions.device_name ELSE COALESCE(EXCLUDED.device_name, user_sessions.device_name) END,
          device_model = COALESCE(EXCLUDED.device_model, user_sessions.device_model),
          platform = COALESCE(EXCLUDED.platform, user_sessions.platform),
          app_version = COALESCE(EXCLUDED.app_version, user_sessions.app_version),
          source = CASE WHEN EXCLUDED.source IN ('web') AND user_sessions.source = 'mobile_app' THEN 'mobile_app' ELSE COALESCE(EXCLUDED.source, user_sessions.source) END,
          is_trusted = EXCLUDED.is_trusted,
          trusted_at = COALESCE(EXCLUDED.trusted_at, user_sessions.trusted_at),
          trust_available_at = CASE
            WHEN EXCLUDED.is_trusted = TRUE THEN EXCLUDED.trust_available_at
            ELSE COALESCE(user_sessions.trust_available_at, EXCLUDED.trust_available_at)
          END,
          expires_at = EXCLUDED.expires_at${deviceIdUpdateSql}${fingerprintUpdateSql},
          revoked_at = NULL,
          revoked_reason = NULL,
          last_activity_at = NOW(),
          last_activity_update_at = NOW(),
          updated_at = NOW()
      RETURNING *
    `, values);

    return result.rows[0] || null;
  };

  const includeFingerprint = Boolean(fingerprint) && await hasUserSessionsFingerprintColumn();
  const includeDeviceId = Boolean(device?.id) && await hasUserSessionsDeviceIdColumn();

  try {
    const row = await insertSession({ includeFingerprint, includeDeviceId });
    console.log('[SESSION_CREATE_OR_UPDATE]', {
      sessionId,
      userId,
      source: context.source,
      ipAddress,
      deviceName: context.deviceName,
      location: geo.location,
      expiresAt
    });
    userSessionsAvailableCache = true;
    return mapSession(row, sessionId);
  } catch (error) {
    if (includeDeviceId && isMissingColumn(error, 'trusted_device_id')) {
      userSessionsDeviceIdColumnCache = false;
      try {
        const row = await insertSession({ includeFingerprint, includeDeviceId: false });
        userSessionsAvailableCache = true;
        return mapSession(row, sessionId);
      } catch (fallbackError) {
        if (includeFingerprint && isMissingColumn(fallbackError, 'device_fingerprint')) {
          userSessionsFingerprintColumnCache = false;
          const row = await insertSession({ includeFingerprint: false, includeDeviceId: false });
          userSessionsAvailableCache = true;
          return mapSession(row, sessionId);
        } else {
          throw fallbackError;
        }
      }
    }
    if (includeFingerprint && isMissingColumn(error, 'device_fingerprint')) {
      userSessionsFingerprintColumnCache = false;
      const row = await insertSession({ includeFingerprint: false, includeDeviceId });
      userSessionsAvailableCache = true;
      return mapSession(row, sessionId);
    }
    if (isMissingSessionTable(error)) {
      userSessionsAvailableCache = false;
      userSessionsFingerprintColumnCache = false;
      return;
    }
    throw error;
  }
}

async function rotateSession({ sessionId, userId, refreshToken, refreshTokenId, expiresAt, req }) {
  if (!sessionId) return;
  if (!(await hasUserSessionsTable())) return;

  // Same UA priority as createSession to keep device info consistent on token rotation
  const userAgent = resolveUserAgent(req);
  const headers = req?.headers || {};
  const parsed = parseDevice(userAgent, headers);
  const ipAddress = getClientIp(req);
  const geo = await resolveIpLocation(ipAddress);
  const context = buildSessionContext(req, parsed, geo);
  try {
    await query(`
    UPDATE user_sessions
    SET refresh_token_id = $3,
        refresh_token_hash = $4,
        expires_at = $5,
        ip_address = CASE WHEN COALESCE($6, ip_address) IN ('127.0.0.1', '::1', '::ffff:127.0.0.1') THEN ip_address ELSE COALESCE($6, ip_address) END,
        user_agent = COALESCE($7, user_agent),
        location = COALESCE($8, location),
        country = COALESCE($9, country),
        region = COALESCE($10, region),
        city = COALESCE($11, city),
        latitude = COALESCE($12, latitude),
        longitude = COALESCE($13, longitude),
        timezone = COALESCE($14, timezone),
        browser = COALESCE($15, browser),
        browser_version = COALESCE($16, browser_version),
        os = COALESCE($17, os),
        os_version = COALESCE($18, os_version),
        device_type = CASE WHEN COALESCE($19, device_type) IN ('unknown', 'Desconocido') THEN device_type ELSE COALESCE($19, device_type) END,
        device_name = CASE WHEN COALESCE($20, device_name) IN ('Dispositivo desconocido', 'Sesion antigua', 'Dispositivo web', 'App movil') THEN device_name ELSE COALESCE($20, device_name) END,
        device_model = COALESCE($21, device_model),
        platform = COALESCE($22, platform),
        app_version = COALESCE($23, app_version),
        source = CASE WHEN COALESCE($24, source) IN ('web') AND source = 'mobile_app' THEN 'mobile_app' ELSE COALESCE($24, source) END,
        last_activity_at = NOW(),
        last_activity_update_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
      AND user_id = $2
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [
      sessionId,
      userId,
      refreshTokenId,
      hashToken(refreshToken),
      expiresAt,
      ipAddress,
      context.userAgent,
      geo.location,
      geo.country,
      geo.region,
      geo.city,
      geo.latitude,
      geo.longitude,
      context.timezone,
      context.browser,
      context.browserVersion,
      context.os,
      context.osVersion,
      context.deviceType,
      context.deviceName,
      context.deviceModel,
      context.platform,
      context.appVersion,
      context.source
    ]);
  } catch (error) {
    if (isMissingSessionTable(error)) return;
    throw error;
  }
}

async function touchSession(sessionId, userId) {
  if (!sessionId || !userId) return;
  if (!(await hasUserSessionsTable())) return;

  try {
    await query(`
    UPDATE user_sessions
    SET last_activity_at = NOW(),
        last_activity_update_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
      AND user_id = $2
      AND revoked_at IS NULL
      AND last_activity_update_at < NOW() - INTERVAL '1 minute'
    `, [sessionId, userId]);
  } catch (error) {
    if (isMissingSessionTable(error)) return;
    throw error;
  }
}

async function validateActiveSession(userId, sessionId) {
  if (!userId || !sessionId) {
    return { active: true, reason: 'LEGACY_TOKEN_WITHOUT_SESSION_ID' };
  }

  if (!isValidUUID(sessionId)) {
    return {
      active: false,
      errorCode: 'INVALID_SESSION',
      message: 'Sesion invalida. Inicie sesion nuevamente.'
    };
  }

  if (!(await hasUserSessionsTable())) {
    return { active: true, reason: 'USER_SESSIONS_TABLE_UNAVAILABLE' };
  }

  try {
    const result = await query(`
      SELECT
        id,
        revoked_at IS NOT NULL AS is_revoked,
        expires_at IS NOT NULL AND expires_at <= NOW() AS is_expired
      FROM user_sessions
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `, [sessionId, userId]);

    const session = result.rows[0];
    if (!session || session.is_revoked) {
      return {
        active: false,
        errorCode: 'SESSION_REVOKED',
        message: 'La sesion fue cerrada. Inicie sesion nuevamente.'
      };
    }

    if (session.is_expired) {
      return {
        active: false,
        errorCode: 'SESSION_EXPIRED',
        message: 'Su sesion ha expirado. Por favor, inicie sesion de nuevo.'
      };
    }

    return { active: true };
  } catch (error) {
    if (isMissingSessionTable(error)) {
      userSessionsAvailableCache = false;
      return { active: true, reason: 'USER_SESSIONS_TABLE_UNAVAILABLE' };
    }
    throw error;
  }
}

async function updateCurrentSessionContext({ userId, workerId = null, sessionId, req, source = null }) {
  if (!sessionId || !userId) return null;
  if (!(await hasUserSessionsTable())) return null;

  const userAgent = resolveUserAgent(req);
  const headers = req?.headers || {};
  const parsed = parseDevice(userAgent, headers);
  const ipAddress = getClientIp(req);
  const geo = await resolveIpLocation(ipAddress);
  const context = buildSessionContext(req, parsed, geo);
  if (source) {
    context.source = normalizeSource(source) || context.source;
  }

  const valuesByColumn = {
    worker_id: workerId || null,
    source: context.source,
    platform: context.platform,
    app_version: context.appVersion,
    user_agent: context.userAgent,
    ip_address: ipAddress,
    location: geo.location,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    latitude: geo.latitude,
    longitude: geo.longitude,
    timezone: context.timezone,
    browser: context.browser,
    browser_version: context.browserVersion,
    os: context.os,
    os_version: context.osVersion,
    device_type: context.deviceType,
    device_name: context.deviceName,
    device_model: context.deviceModel,
    last_activity_at: new Date(),
    last_activity_update_at: new Date(),
    updated_at: new Date()
  };

  try {
    const columns = await getTableColumns('user_sessions');
    const entries = Object.entries(valuesByColumn)
      .filter(([column, value]) => columns.has(column) && value !== undefined);

    if (entries.length === 0) return null;

    const setSql = entries.map(([column], index) => `${column} = COALESCE($${index + 1}, ${column})`).join(', ');
    const params = entries.map(([, value]) => value);
    params.push(sessionId, userId);

    const result = await query(
      `UPDATE user_sessions
       SET ${setSql}
       WHERE id = $${params.length - 1}
         AND user_id = $${params.length}
         AND revoked_at IS NULL
       RETURNING *`,
      params
    );

    return mapSession(result.rows[0], sessionId);
  } catch (error) {
    if (isMissingSessionTable(error)) return null;
    throw error;
  }
}

async function listSessions(userId, currentSessionId = null) {
  if (await hasUserSessionsTable()) {
    const hasDeviceIdColumn = await hasUserSessionsDeviceIdColumn();
    const hasFingerprintColumn = await hasUserSessionsFingerprintColumn();
    const canJoinDevices = await hasTrustedDevicesTable() && (hasDeviceIdColumn || hasFingerprintColumn);
    const deviceJoinConditions = [
      hasDeviceIdColumn ? 'td.id = us.trusted_device_id' : null,
      hasFingerprintColumn ? '(td.user_id = us.user_id AND td.device_fingerprint = us.device_fingerprint)' : null
    ].filter(Boolean).join(' OR ');

    const result = canJoinDevices
      ? await query(`
        SELECT us.*,
               ${hasDeviceIdColumn ? 'COALESCE(us.trusted_device_id, td.id)' : 'td.id'} AS resolved_trusted_device_id,
               ${hasFingerprintColumn ? 'us.device_fingerprint' : 'td.device_fingerprint'} AS resolved_device_fingerprint,
               td.is_trusted AS device_is_trusted,
               td.trusted_at AS device_trusted_at,
               td.trust_expires_at AS device_trust_expires_at,
               td.revoked_at AS device_revoked_at
        FROM user_sessions us
        LEFT JOIN LATERAL (
          SELECT td.*
          FROM trusted_devices td
          WHERE ${deviceJoinConditions}
          ORDER BY ${hasDeviceIdColumn ? 'CASE WHEN td.id = us.trusted_device_id THEN 0 ELSE 1 END' : '0'}
          LIMIT 1
        ) td ON TRUE
        WHERE us.user_id = $1
          AND us.revoked_at IS NULL
          AND (us.expires_at IS NULL OR us.expires_at > NOW())
          AND (
            us.user_agent IS NOT NULL
            OR us.ip_address IS NOT NULL
            OR ($2::uuid IS NOT NULL AND us.id = $2::uuid)
          )
        ORDER BY us.last_activity_at DESC NULLS LAST, us.created_at DESC
      `, [userId, currentSessionId || null])
      : await query(`
        SELECT *
        FROM user_sessions
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (
            user_agent IS NOT NULL
            OR ip_address IS NOT NULL
            OR ($2::uuid IS NOT NULL AND id = $2::uuid)
          )
        ORDER BY last_activity_at DESC NULLS LAST, created_at DESC
      `, [userId, currentSessionId || null]);

    userSessionsAvailableCache = true;
    return result.rows.map((row) => mapSession(row, currentSessionId));
  }

  const fallback = await query(`
    SELECT id AS refresh_token_id,
           user_id,
           token,
           created_at,
           expires_at
    FROM refresh_tokens
    WHERE user_id = $1
      AND revoked = FALSE
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  return mapLegacyRefreshTokenRows(fallback.rows, currentSessionId);
}

async function revokeSession(userId, sessionId, req) {
  assertSessionId(sessionId);
  if (!(await hasUserSessionsTable())) {
    const err = new Error('La sesion ya no existe.');
    err.statusCode = 404;
    err.errorCode = 'SESSION_NOT_FOUND';
    throw err;
  }

  const result = await withTransaction(async (client) => {
    const sessionRes = await client.query(`
      SELECT id, refresh_token_id, revoked_at
      FROM user_sessions
      WHERE id = $1
        AND user_id = $2
        AND (expires_at IS NULL OR expires_at > NOW())
      FOR UPDATE
    `, [sessionId, userId]);

    const session = sessionRes.rows[0];
    if (!session) return { error: 'SESSION_NOT_FOUND' };
    if (session.revoked_at) return { error: 'SESSION_ALREADY_REVOKED' };

    await client.query(`
      UPDATE user_sessions
      SET revoked_at = NOW(),
          revoked_reason = 'USER_REVOKED'
      WHERE id = $1
    `, [sessionId]);

    if (session.refresh_token_id) {
      await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [session.refresh_token_id]);
    }

    return { session };
  });

  if (result.error) {
    const err = new Error(result.error === 'SESSION_NOT_FOUND' ? 'La sesion ya no existe.' : 'La sesion ya fue cerrada.');
    err.statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : 409;
    err.errorCode = result.error;
    throw err;
  }

  await logAudit({
    userId,
    companyId: req.tenantId,
    module: 'PROFILE',
    action: 'SESSION_REVOKED',
    entity: 'user_sessions',
    entityId: sessionId,
    newData: { session_id: sessionId },
    req
  });

  return { success: true, message: 'Sesion cerrada correctamente.' };
}

async function revokeOtherSessions(userId, currentSessionId, req) {
  const logger = require('../../shared/utils/logger');

  if (!(await hasUserSessionsTable())) {
    const fallbackResult = await withTransaction(async (client) => {
      const revoked = await revokeOtherRefreshTokens(client, userId, currentSessionId);
      logger.logInfo('SESSION',
        `[SESSION REVOKE OTHERS LEGACY] userId=${userId} tokens=${revoked.tokenCount}`);
      return {
        sessionCount: 0,
        tokenCount: revoked.tokenCount,
        revokedCount: revoked.tokenCount
      };
    });

    await logAudit({
      userId,
      companyId: req.tenantId,
      module: 'PROFILE',
      action: 'OTHER_SESSIONS_REVOKED',
      entity: 'refresh_tokens',
      newData: {
        revoked_sessions: 0,
        revoked_tokens: fallbackResult.tokenCount
      },
      req
    });

    return {
      success: true,
      message: fallbackResult.revokedCount > 0
        ? `Se cerraron ${fallbackResult.revokedCount} sesiones en otros dispositivos.`
        : 'No habia otras sesiones activas.',
      revokedCount: fallbackResult.revokedCount,
      data: {
        revokedCount: fallbackResult.revokedCount,
        revokedTokens: fallbackResult.tokenCount
      }
    };
  }

  const result = await withTransaction(async (client) => {
    // 1. Revoke all other active sessions in user_sessions
    const sessionsRes = await client.query(`
      UPDATE user_sessions
      SET revoked_at = NOW(),
          expires_at = NOW(),
          revoked_reason = 'USER_REVOKED_OTHERS',
          updated_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      RETURNING id, refresh_token_id
    `, [userId, currentSessionId || null]);

    const sessionCount = sessionsRes.rowCount || 0;
    const tokenIds = sessionsRes.rows.map((row) => row.refresh_token_id).filter(Boolean);

    // 2. Revoke and immediately expire the associated refresh tokens
    //    so that any outstanding access tokens cannot be silently refreshed.
    let tokenCount = 0;
    if (tokenIds.length > 0) {
      const tokensRes = await client.query(
        `UPDATE refresh_tokens
         SET revoked = TRUE,
             expires_at = NOW()
         WHERE id = ANY($1::uuid[])
         RETURNING id`,
        [tokenIds]
      );
      tokenCount = tokensRes.rowCount || 0;
    }

    const legacyTokens = await revokeOtherRefreshTokens(client, userId, currentSessionId, tokenIds);
    tokenCount += legacyTokens.tokenCount;

    logger.logInfo('SESSION',
      `[SESSION REVOKE OTHERS] userId=${userId} sessions=${sessionCount} tokens=${tokenCount}`);

    return {
      sessionCount,
      tokenCount,
      revokedCount: Math.max(sessionCount, tokenCount)
    };
  });

  await logAudit({
    userId,
    companyId: req.tenantId,
    module: 'PROFILE',
    action: 'OTHER_SESSIONS_REVOKED',
    entity: 'user_sessions',
    newData: {
      revoked_sessions: result.sessionCount,
      revoked_tokens: result.tokenCount
    },
    req
  });

  return {
    success: true,
    message: result.revokedCount > 0
      ? `Se cerraron ${result.revokedCount} sesiones en otros dispositivos.`
      : 'No habia otras sesiones activas.',
    revokedCount: result.revokedCount,
    data: {
      revokedCount: result.revokedCount,
      revokedTokens: result.tokenCount
    }
  };
}

async function trustSession(userId, sessionId, req) {
  assertSessionId(sessionId);
  if (!(await hasUserSessionsTable())) {
    const err = new Error('La sesion ya no existe.');
    err.statusCode = 404;
    err.errorCode = 'SESSION_NOT_FOUND';
    throw err;
  }

  const trustedDevicesAvailable = await hasTrustedDevicesTable();

  const result = await withTransaction(async (client) => {
    const sessionRes = await client.query(`
      SELECT *
      FROM user_sessions
      WHERE id = $1
        AND user_id = $2
        AND (expires_at IS NULL OR expires_at > NOW())
      FOR UPDATE
    `, [sessionId, userId]);

    const session = sessionRes.rows[0];
    if (!session) return { error: 'SESSION_NOT_FOUND' };
    if (session.revoked_at) return { error: 'SESSION_ALREADY_REVOKED' };
    if (session.is_trusted) return { session };

    const trustAvailableAt = session.trust_available_at
      || new Date(new Date(session.created_at).getTime() + TRUST_WAIT_DAYS * 24 * 60 * 60 * 1000);
    if (trustAvailableAt > new Date()) {
      return { error: 'TRUST_WAITING_PERIOD_NOT_MET', trustAvailableAt };
    }

    const trustedRes = await client.query(`
      UPDATE user_sessions
      SET is_trusted = TRUE,
          trusted_at = NOW(),
          expires_at = NOW() + INTERVAL '${TRUSTED_SESSION_DAYS} days',
          last_activity_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [sessionId]);

    const trusted = trustedRes.rows[0];
    if (trusted.refresh_token_id) {
      await client.query(`
        UPDATE refresh_tokens
        SET expires_at = $2
        WHERE id = $1
      `, [trusted.refresh_token_id, trusted.expires_at]);
    }

    let trustedDevice = null;
    const trustedDeviceId = trusted.trusted_device_id || trusted.device_id;
    if (trustedDevicesAvailable && trustedDeviceId) {
      const deviceRes = await client.query(`
        UPDATE trusted_devices
        SET is_trusted = TRUE,
            trusted_at = COALESCE(trusted_at, NOW()),
            trust_expires_at = NOW() + INTERVAL '${TRUSTED_SESSION_DAYS} days',
            revoked_at = NULL,
            revoked_reason = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
        RETURNING *
      `, [trustedDeviceId, userId]);
      trustedDevice = deviceRes.rows[0] || null;
    } else if (trustedDevicesAvailable && trusted.device_fingerprint) {
      const deviceRes = await client.query(`
        UPDATE trusted_devices
        SET is_trusted = TRUE,
            trusted_at = COALESCE(trusted_at, NOW()),
            trust_expires_at = NOW() + INTERVAL '${TRUSTED_SESSION_DAYS} days',
            revoked_at = NULL,
            revoked_reason = NULL,
            updated_at = NOW()
        WHERE user_id = $1
          AND device_fingerprint = $2
        RETURNING *
      `, [userId, trusted.device_fingerprint]);
      trustedDevice = deviceRes.rows[0] || null;
    }

    if (trustedDevice) {
      trusted.trusted_device_id = trustedDevice.id;
      trusted.device_is_trusted = trustedDevice.is_trusted;
      trusted.device_trusted_at = trustedDevice.trusted_at;
      trusted.device_trust_expires_at = trustedDevice.trust_expires_at;
      trusted.device_revoked_at = trustedDevice.revoked_at;
    }

    return { session: trusted };
  });

  if (result.error === 'TRUST_WAITING_PERIOD_NOT_MET') {
    const err = new Error('El dispositivo aun no puede marcarse como confiable.');
    err.statusCode = 422;
    err.errorCode = result.error;
    err.details = { trustAvailableAt: toIso(result.trustAvailableAt) };
    throw err;
  }

  if (result.error) {
    const err = new Error(result.error === 'SESSION_NOT_FOUND' ? 'La sesion ya no existe.' : 'La sesion no puede marcarse como confiable.');
    err.statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : 409;
    err.errorCode = result.error;
    throw err;
  }

  await logAudit({
    userId,
    companyId: req.tenantId,
    module: 'PROFILE',
    action: 'DEVICE_TRUSTED',
    entity: 'user_sessions',
    entityId: sessionId,
    newData: { session_id: sessionId },
    req
  });

  return {
    success: true,
    message: 'Dispositivo marcado como confiable.',
    data: mapSession(result.session, sessionId)
  };
}

async function revokeByRefreshToken(userId, refreshToken, req) {
  const result = { sessionCount: 0, tokenCount: 0 };
  if (!refreshToken || !userId) return result;

  try {
    const tokenRes = await query(
      'SELECT id FROM refresh_tokens WHERE user_id = $1 AND token = $2 LIMIT 1',
      [userId, refreshToken]
    );
    const refreshTokenId = tokenRes.rows[0]?.id;
    if (!refreshTokenId) return result;

    const revokedToken = await query(`
      UPDATE refresh_tokens
      SET revoked = TRUE
      WHERE id = $1
        AND user_id = $2
        AND revoked = FALSE
      RETURNING id
    `, [refreshTokenId, userId]);
    result.tokenCount = revokedToken.rowCount || 0;

    if (!(await hasUserSessionsTable())) {
      return result;
    }

    const currentSessionId = isValidUUID(req?.user?.sessionId) ? req.user.sessionId : null;
    const sessionValues = [userId, refreshTokenId];
    let sessionPredicate = 'refresh_token_id = $2';
    if (currentSessionId) {
      sessionValues.push(currentSessionId);
      sessionPredicate = `(${sessionPredicate} OR id = $3::uuid)`;
    }

    const revokedSessions = await query(`
      UPDATE user_sessions
      SET revoked_at = NOW(),
          revoked_reason = 'LOGOUT',
          updated_at = NOW()
      WHERE user_id = $1
        AND ${sessionPredicate}
        AND revoked_at IS NULL
    `, sessionValues);
    result.sessionCount = revokedSessions.rowCount || 0;
    return result;
  } catch (error) {
    if (isMissingSessionTable(error)) {
      userSessionsAvailableCache = false;
      return result;
    }
    throw error;
  }
}

async function cleanupObsoleteSessions(activeSessionId = null) {
  if (!(await hasUserSessionsTable())) return 0;
  const logger = require('../../shared/utils/logger');
  try {
    // Delete sessions that have no metadata (legacy migrated) AND are either:
    // - expired, OR
    // - older than 7 days (stale legacy with no useful data)
    // Always preserve the active session.
    const result = await query(`
      DELETE FROM user_sessions
      WHERE user_agent IS NULL
        AND ip_address IS NULL
        AND ($1::uuid IS NULL OR id <> $1::uuid)
        AND (
          (expires_at IS NOT NULL AND expires_at < NOW())
          OR created_at < NOW() - INTERVAL '7 days'
        )
    `, [activeSessionId]);
    const deletedCount = result.rowCount || 0;
    logger.logInfo('SESSION', `[SESSION CLEANUP] Eliminadas ${deletedCount} sesiones obsoletas/sin metadata.`);
    return deletedCount;
  } catch (error) {
    if (isMissingSessionTable(error)) return 0;
    throw error;
  }
}

async function runSessionsBackfill() {
  if (!(await hasUserSessionsTable())) return;

  const logger = require('../../shared/utils/logger');
  logger.logInfo('SESSION', '[SESSION BACKFILL] Iniciando backfill de metadatos de sesiones...');

  try {
    let limit = 100;
    let offset = 0;
    let totalUpdated = 0;

    while (true) {
      const result = await query(`
        SELECT id, user_agent
        FROM user_sessions
        WHERE user_agent IS NOT NULL
          AND (browser IS NULL OR os IS NULL OR device_type IS NULL OR device_name IS NULL OR device_type = 'unknown' OR device_name = 'Dispositivo desconocido')
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      const rows = result.rows;
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const parsed = parseDevice(row.user_agent);
        await query(`
          UPDATE user_sessions
          SET browser = COALESCE(browser, $2),
              os = COALESCE(os, $3),
              device_type = CASE WHEN device_type IS NULL OR device_type = 'unknown' THEN $4 ELSE device_type END,
              device_name = CASE WHEN device_name IS NULL OR device_name = 'Dispositivo desconocido' THEN $5 ELSE device_name END,
              updated_at = NOW()
          WHERE id = $1
        `, [
          row.id,
          parsed.browser,
          parsed.os,
          parsed.deviceType,
          parsed.deviceName
        ]);
        totalUpdated++;
      }

      offset += limit;
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (totalUpdated > 0) {
      logger.logInfo('SESSION', `[SESSION BACKFILL] Backfill completado. Se actualizaron ${totalUpdated} sesiones.`);
    } else {
      logger.logInfo('SESSION', '[SESSION BACKFILL] No se encontraron sesiones para actualizar.');
    }
  } catch (error) {
    if (isMissingSessionTable(error)) return;
    logger.logError('SESSION', 'Error durante el backfill de sesiones', error);
  }
}

function __resetSessionMetadataCachesForTests() {
  userSessionsAvailableCache = null;
  userSessionsFingerprintColumnCache = null;
  userSessionsDeviceIdColumnCache = null;
  trustedDevicesAvailableCache = null;
}

module.exports = {
  DEFAULT_SESSION_DAYS,
  TRUST_WAIT_DAYS,
  hashToken,
  mapSession,
  findReusableSessionId,
  createSession,
  rotateSession,
  touchSession,
  validateActiveSession,
  updateCurrentSessionContext,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  trustSession,
  revokeByRefreshToken,
  cleanupObsoleteSessions,
  runSessionsBackfill,
  __resetSessionMetadataCachesForTests
};
