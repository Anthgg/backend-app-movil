const crypto = require('crypto');
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

function isMissingSessionTable(error) {
  return error?.code === '42P01' || error?.code === '42703' || /user_sessions/i.test(error?.message || '');
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
  const isTrusted = row.is_trusted === true;
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
    ipAddress: row.ip_address || null,
    isTrusted,
    trustedAt: toIso(row.trusted_at),
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

async function createSession({ userId, companyId, refreshToken, refreshTokenId, sessionId, expiresAt, req }) {
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

  logger.logInfo('SESSION', `[SESSION CREATED] ip=${ipAddress} browser=${parsed.browser} os=${parsed.os} deviceType=${parsed.deviceType} deviceName=${parsed.deviceName}`);

  try {
    await query(`
      INSERT INTO user_sessions (
        id, user_id, company_id, refresh_token_id, refresh_token_hash, ip_address, user_agent,
        location, country, city, latitude, longitude, browser, os, device_type, device_name,
        is_trusted, trust_available_at, last_activity_at, last_activity_update_at, expires_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,FALSE,NOW() + $17::interval,NOW(),NOW(),$18,NOW())
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
          expires_at = EXCLUDED.expires_at,
          revoked_at = NULL,
          revoked_reason = NULL,
          last_activity_at = NOW(),
          last_activity_update_at = NOW(),
          updated_at = NOW()
    `, [
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
      TRUST_WAIT_INTERVAL_SQL,
      expiresAt
    ]);
    userSessionsAvailableCache = true;
  } catch (error) {
    if (isMissingSessionTable(error)) {
      userSessionsAvailableCache = false;
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
    // Exclude legacy sessions (migrated without metadata) unless they are the current session.
    // A session is considered legacy if it has no user_agent AND no ip_address.
    const result = await query(`
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
    SELECT id,
           user_id,
           NULL::text AS user_agent,
           NULL::text AS location,
           NULL::text AS country,
           NULL::text AS city,
           NULL::numeric AS latitude,
           NULL::numeric AS longitude,
           NULL::text AS browser,
           NULL::text AS os,
           'unknown' AS device_type,
           NULL::text AS device_name,
           NULL::text AS ip_address,
           FALSE AS is_trusted,
           NULL::timestamptz AS trust_available_at,
           NULL::timestamptz AS trusted_at,
           created_at,
           created_at AS last_activity_at,
           expires_at,
           NULL::timestamptz AS revoked_at
    FROM refresh_tokens
    WHERE user_id = $1
      AND revoked = FALSE
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  return fallback.rows.map((row) => mapSession(row, currentSessionId));
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
  if (!(await hasUserSessionsTable())) {
    return {
      success: true,
      message: 'Se cerraron las demas sesiones correctamente.',
      revokedCount: 0,
      data: {
        revokedCount: 0
      }
    };
  }

  const result = await withTransaction(async (client) => {
    const sessionsRes = await client.query(`
      UPDATE user_sessions
      SET revoked_at = NOW(),
          revoked_reason = 'USER_REVOKED_OTHERS'
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      RETURNING refresh_token_id
    `, [userId, currentSessionId || null]);

    const tokenIds = sessionsRes.rows.map((row) => row.refresh_token_id).filter(Boolean);
    if (tokenIds.length > 0) {
      await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = ANY($1::uuid[])', [tokenIds]);
    }

    return sessionsRes.rowCount;
  });

  await logAudit({
    userId,
    companyId: req.tenantId,
    module: 'PROFILE',
    action: 'OTHER_SESSIONS_REVOKED',
    entity: 'user_sessions',
    newData: { revoked_count: result },
    req
  });

  return {
    success: true,
    message: 'Se cerraron las demas sesiones correctamente.',
    revokedCount: result,
    data: {
      revokedCount: result
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
  if (!refreshToken) return;
  if (!(await hasUserSessionsTable())) return;

  try {
    await withTransaction(async (client) => {
      const tokenRes = await client.query(
        'SELECT id FROM refresh_tokens WHERE user_id = $1 AND token = $2 LIMIT 1',
        [userId, refreshToken]
      );
      const refreshTokenId = tokenRes.rows[0]?.id;
      if (!refreshTokenId) return;

      await client.query(`
        UPDATE user_sessions
        SET revoked_at = NOW(),
            revoked_reason = 'LOGOUT',
            updated_at = NOW()
        WHERE user_id = $1
          AND refresh_token_id = $2
          AND revoked_at IS NULL
      `, [userId, refreshTokenId]);
    });
  } catch (error) {
    if (isMissingSessionTable(error)) return;
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

module.exports = {
  DEFAULT_SESSION_DAYS,
  TRUST_WAIT_DAYS,
  hashToken,
  mapSession,
  createSession,
  rotateSession,
  touchSession,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  trustSession,
  revokeByRefreshToken,
  cleanupObsoleteSessions,
  runSessionsBackfill
};
