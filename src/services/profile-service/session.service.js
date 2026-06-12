const crypto = require('crypto');
const { query, withTransaction } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const { getClientIp, parseDevice } = require('../../shared/utils/device-parser');
const { isValidUUID } = require('../../utils/uuid.util');

const TRUST_WAIT_DAYS = 7;
const TRUSTED_SESSION_DAYS = 30;
const DEFAULT_SESSION_DAYS = 7;
const TRUST_WAIT_INTERVAL_SQL = `${TRUST_WAIT_DAYS} days`;
let userSessionsAvailableCache = null;

function isMissingSessionTable(error) {
  return error?.code === '42P01' || /user_sessions/i.test(error?.message || '');
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

function mapSession(row, currentSessionId = null) {
  const trustAvailableAt = row.trust_available_at
    || (row.created_at ? new Date(new Date(row.created_at).getTime() + TRUST_WAIT_DAYS * 24 * 60 * 60 * 1000) : null);
  const isTrusted = row.is_trusted === true;
  const isCurrent = currentSessionId && row.id === currentSessionId;
  const canTrust = !isTrusted && trustAvailableAt && trustAvailableAt <= new Date();

  return {
    id: row.id,
    userId: row.user_id || null,
    userAgent: row.user_agent || null,
    browser: row.browser || null,
    os: row.os || null,
    deviceType: row.device_type || 'unknown',
    deviceName: row.device_name || [row.os, row.browser].filter(Boolean).join(' · ') || 'Dispositivo no identificado',
    ipAddress: row.ip_address || null,
    isTrusted,
    trustedAt: toIso(row.trusted_at),
    createdAt: toIso(row.created_at),
    lastActivityAt: toIso(row.last_activity_at),
    expiresAt: toIso(row.expires_at),
    isCurrent: Boolean(isCurrent),
    canTrust: Boolean(canTrust),
    trustAvailableAt: toIso(trustAvailableAt),
    revokedAt: toIso(row.revoked_at)
  };
}

function assertSessionId(sessionId) {
  if (!isValidUUID(sessionId)) {
    const err = new Error('sessionId invalido. Debe ser un UUID valido.');
    err.statusCode = 400;
    err.errorCode = 'INVALID_SESSION_ID';
    throw err;
  }
}

async function createSession({ userId, companyId, refreshToken, refreshTokenId, sessionId, expiresAt, req }) {
  if (!sessionId) return;
  if (!(await hasUserSessionsTable())) return;

  const userAgent = req?.headers?.['user-agent'] || null;
  const parsed = parseDevice(userAgent);

  try {
    await query(`
      INSERT INTO user_sessions (
        id, user_id, company_id, refresh_token_id, refresh_token_hash, ip_address, user_agent,
        browser, os, device_type, device_name, is_trusted, trust_available_at,
        last_activity_at, last_activity_update_at, expires_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,NOW() + $12::interval,NOW(),NOW(),$13,NOW())
      ON CONFLICT (id) DO UPDATE
      SET company_id = COALESCE(EXCLUDED.company_id, user_sessions.company_id),
          refresh_token_id = EXCLUDED.refresh_token_id,
          refresh_token_hash = EXCLUDED.refresh_token_hash,
          ip_address = EXCLUDED.ip_address,
          user_agent = EXCLUDED.user_agent,
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
      getClientIp(req),
      parsed.userAgent,
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

  const userAgent = req?.headers?.['user-agent'] || null;
  const parsed = parseDevice(userAgent);
  try {
    await query(`
    UPDATE user_sessions
    SET refresh_token_id = $3,
        refresh_token_hash = $4,
        expires_at = $5,
        ip_address = COALESCE($6, ip_address),
        user_agent = COALESCE($7, user_agent),
        browser = COALESCE($8, browser),
        os = COALESCE($9, os),
        device_type = COALESCE($10, device_type),
        device_name = COALESCE($11, device_name),
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
      getClientIp(req),
      parsed.userAgent,
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
      AND last_activity_update_at < NOW() - INTERVAL '5 minutes'
    `, [sessionId, userId]);
  } catch (error) {
    if (isMissingSessionTable(error)) return;
    throw error;
  }
}

async function listSessions(userId, currentSessionId = null) {
  if (await hasUserSessionsTable()) {
    const result = await query(`
      SELECT *
      FROM user_sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY last_activity_at DESC NULLS LAST, created_at DESC
    `, [userId]);

    userSessionsAvailableCache = true;
    return result.rows.map((row) => mapSession(row, currentSessionId));
  }

  const fallback = await query(`
    SELECT id,
           user_id,
           NULL::text AS user_agent,
           id::text AS browser,
           NULL::text AS os,
           'unknown' AS device_type,
           'Sesion activa' AS device_name,
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
    const err = new Error('Sesion no encontrada.');
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
    const err = new Error(result.error === 'SESSION_NOT_FOUND' ? 'Sesion no encontrada.' : 'La sesion ya fue revocada.');
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
      revokedCount: 0
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
    revokedCount: result
  };
}

async function trustSession(userId, sessionId, req) {
  assertSessionId(sessionId);
  if (!(await hasUserSessionsTable())) {
    const err = new Error('Sesion no encontrada.');
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
    const err = new Error('Debes esperar el periodo de gracia requerido para marcar esta sesion como confiable.');
    err.statusCode = 422;
    err.errorCode = result.error;
    err.details = { trustAvailableAt: toIso(result.trustAvailableAt) };
    throw err;
  }

  if (result.error) {
    const err = new Error(result.error === 'SESSION_NOT_FOUND' ? 'Sesion no encontrada.' : 'La sesion no puede marcarse como confiable.');
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
  revokeByRefreshToken
};
