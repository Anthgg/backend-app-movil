const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const { getClientIp, parseDevice, resolveUserAgent } = require('../../shared/utils/device-parser');
const { resolveIpLocation } = require('../../shared/utils/ip-geolocation');
const { isValidUUID } = require('../../utils/uuid.util');

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
  const inferred = row.user_agent ? parseDevice(row.user_agent) : null;
  const browser = cleanBrowser(row)
    || (!isUnknownLabel(inferred?.browser) ? inferred?.browser : null)
    || null;
  const os = cleanText(row.os)
    || (!isUnknownLabel(inferred?.os) ? inferred?.os : null)
    || null;
  const storedDeviceType = cleanText(row.device_type);
  const deviceType = storedDeviceType && storedDeviceType !== 'unknown'
    ? storedDeviceType
    : (inferred?.deviceType || storedDeviceType || 'unknown');
  const inferredDeviceName = inferred?.deviceName && inferred.deviceName !== 'Dispositivo desconocido'
    ? inferred.deviceName
    : null;
  const deviceName = cleanDeviceName(row.device_name)
    || inferredDeviceName
    || genericDeviceName(os, deviceType);
  const trustAvailableAt = row.trust_available_at
    || (row.created_at ? new Date(new Date(row.created_at).getTime() + TRUST_WAIT_DAYS * 24 * 60 * 60 * 1000) : null);
  const { isTrusted, trustedAt, trustExpiresAt } = getDeviceTrustFields(row);
  const isCurrent = currentSessionId && row.id === currentSessionId;
  const canTrust = !isTrusted && trustAvailableAt && trustAvailableAt <= new Date();

  const isLegacy = !row.user_agent && !row.ip_address;

  return {
    id: row.id,
    userId: row.user_id || null,
    userAgent: row.user_agent || null,
    location: row.location || null,
    country: row.country || null,
    city: row.city || null,
    latitude: row.latitude !== undefined && row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== undefined && row.longitude !== null ? Number(row.longitude) : null,
    browser,
    os,
    deviceType,
    deviceName,
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

async function createSession({ userId, companyId, refreshToken, refreshTokenId, sessionId, expiresAt, req, fingerprint }) {
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
  const device = await upsertTrustedDevice({
    userId,
    companyId,
    fingerprint,
    parsed,
    userAgent: parsed.userAgent,
    ipAddress,
    geo
  });
  const deviceTrusted = isDeviceTrustActive(device);
  const sessionTrustedAt = deviceTrusted ? device.trusted_at : null;
  const trustAvailableAt = deviceTrusted ? new Date() : null;

  logger.logInfo('SESSION', `[SESSION CREATED] ip=${ipAddress} browser=${parsed.browser} os=${parsed.os} deviceType=${parsed.deviceType} deviceName=${parsed.deviceName}`);

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
      refreshTokenId,
      hashToken(refreshToken),
      ipAddress,
      parsed.userAgent,
      geo.location,
      geo.country,
      geo.city,
      geo.latitude,
      geo.longitude,
      parsed.browser,
      parsed.os,
      parsed.deviceType,
      parsed.deviceName,
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

    await query(`
      INSERT INTO user_sessions (
        id, user_id, company_id, refresh_token_id, refresh_token_hash, ip_address, user_agent,
        location, country, city, latitude, longitude, browser, os, device_type, device_name,
        is_trusted, trusted_at, trust_available_at, last_activity_at, last_activity_update_at, expires_at, updated_at${deviceIdColumnSql}${fingerprintColumnSql}
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,COALESCE($19::timestamptz,NOW() + $20::interval),NOW(),NOW(),$21,NOW()${deviceIdValueSql}${fingerprintValueSql})
      ON CONFLICT (id) DO UPDATE
      SET company_id = COALESCE(EXCLUDED.company_id, user_sessions.company_id),
          refresh_token_id = EXCLUDED.refresh_token_id,
          refresh_token_hash = EXCLUDED.refresh_token_hash,
          ip_address = EXCLUDED.ip_address,
          user_agent = EXCLUDED.user_agent,
          location = EXCLUDED.location,
          country = EXCLUDED.country,
          city = EXCLUDED.city,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          browser = EXCLUDED.browser,
          os = EXCLUDED.os,
          device_type = EXCLUDED.device_type,
          device_name = EXCLUDED.device_name,
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
    `, values);
  };

  const includeFingerprint = Boolean(fingerprint) && await hasUserSessionsFingerprintColumn();
  const includeDeviceId = Boolean(device?.id) && await hasUserSessionsDeviceIdColumn();

  try {
    await insertSession({ includeFingerprint, includeDeviceId });
    userSessionsAvailableCache = true;
  } catch (error) {
    if (includeDeviceId && isMissingColumn(error, 'trusted_device_id')) {
      userSessionsDeviceIdColumnCache = false;
      try {
        await insertSession({ includeFingerprint, includeDeviceId: false });
      } catch (fallbackError) {
        if (includeFingerprint && isMissingColumn(fallbackError, 'device_fingerprint')) {
          userSessionsFingerprintColumnCache = false;
          await insertSession({ includeFingerprint: false, includeDeviceId: false });
        } else {
          throw fallbackError;
        }
      }
      userSessionsAvailableCache = true;
      return;
    }
    if (includeFingerprint && isMissingColumn(error, 'device_fingerprint')) {
      userSessionsFingerprintColumnCache = false;
      await insertSession({ includeFingerprint: false, includeDeviceId });
      userSessionsAvailableCache = true;
      return;
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
  try {
    await query(`
    UPDATE user_sessions
    SET refresh_token_id = $3,
        refresh_token_hash = $4,
        expires_at = $5,
        ip_address = COALESCE(ip_address, $6),
        user_agent = COALESCE($7, user_agent),
        location = COALESCE(location, $8),
        country = COALESCE(country, $9),
        city = COALESCE(city, $10),
        latitude = COALESCE(latitude, $11),
        longitude = COALESCE(longitude, $12),
        browser = COALESCE($13, browser),
        os = COALESCE($14, os),
        device_type = COALESCE($15, device_type),
        device_name = COALESCE($16, device_name),
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
      parsed.userAgent,
      geo.location,
      geo.country,
      geo.city,
      geo.latitude,
      geo.longitude,
      parsed.browser,
      parsed.os,
      parsed.deviceType,
      parsed.deviceName
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
  listSessions,
  revokeSession,
  revokeOtherSessions,
  trustSession,
  revokeByRefreshToken,
  cleanupObsoleteSessions,
  runSessionsBackfill,
  __resetSessionMetadataCachesForTests
};
