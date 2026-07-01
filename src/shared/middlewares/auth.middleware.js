const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const logger = require('../utils/logger');
const { query } = require('../../config/database');
const { resolveUserAccess } = require('../utils/authz');
const { createCatalogCache } = require('../utils/catalog-cache');
const sessionService = require('../../services/profile-service/session.service');

const authenticatedUserCache = createCatalogCache(30 * 1000);
const pendingAuthenticatedUserLookups = new Map();

const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/auth/change-password',
  '/api/auth/change-password',
  '/profile/change-password',
  '/api/profile/change-password',
  '/profile/password',
  '/api/profile/password',
  '/auth/logout',
  '/api/auth/logout',
  '/auth/me',
  '/api/auth/me',
  '/users/me',
  '/api/users/me',
  '/profile',
  '/api/profile',
  '/profile/me',
  '/api/profile/me',
  '/profile/current',
  '/api/profile/current'
]);

function getRequestPath(req) {
  const rawPath = req.originalUrl || req.url || req.path || '';
  try {
    return new URL(rawPath, 'http://local').pathname;
  } catch {
    return String(rawPath).split('?')[0];
  }
}

function isPasswordChangeAllowedRequest(req) {
  if (req.method === 'OPTIONS') return true;
  return PASSWORD_CHANGE_ALLOWED_PATHS.has(getRequestPath(req));
}

function buildPasswordChangeRequiredResponse() {
  return {
    success: false,
    message: 'Debes cambiar tu contrasena temporal antes de continuar.',
    code: 'PASSWORD_CHANGE_REQUIRED',
    error_code: 'PASSWORD_CHANGE_REQUIRED',
    errorCode: 'PASSWORD_CHANGE_REQUIRED',
    passwordChangeRequired: true,
    password_change_required: true,
    forcePasswordChange: true,
    force_password_change: true,
    data: {
      passwordChangeRequired: true,
      password_change_required: true,
      forcePasswordChange: true,
      force_password_change: true,
      changePasswordPath: '/auth/change-password',
      change_password_path: '/auth/change-password'
    }
  };
}

function enforcePasswordChangeIfRequired(req, res) {
  if (req.user?.forcePasswordChange !== true) {
    return false;
  }

  if (isPasswordChangeAllowedRequest(req)) {
    return false;
  }

  res.status(403).json(buildPasswordChangeRequiredResponse());
  return true;
}

function clearAuthenticatedUserCache(userId) {
  if (userId && typeof authenticatedUserCache.delete === 'function') {
    authenticatedUserCache.delete(userId);
    return;
  }

  authenticatedUserCache.clear();
}

function touchAuthenticatedSession(user) {
  if (!user?.sessionId || !user?.id) return;
  sessionService.touchSession(user.sessionId, user.id).catch((error) => {
    logger.logWarn('AUTH', 'No se pudo actualizar actividad de sesion', {
      user_id: user.id,
      session_id: user.sessionId,
      error: error.message
    });
  });
}

async function ensureTokenSessionIsActive(decoded) {
  const sessionState = await sessionService.validateActiveSession(decoded.id, decoded.sessionId);
  if (sessionState.active) return;

  const error = new Error(sessionState.message || 'La sesion ya no esta activa. Inicie sesion nuevamente.');
  error.statusCode = 401;
  error.errorCode = sessionState.errorCode || 'SESSION_REVOKED';
  throw error;
}

async function resolveAuthenticatedUser(decoded) {
  const userRes = await query(`
    SELECT u.id,
           u.company_id,
           u.is_active,
           u.status,
           u.deleted_at,
           COALESCE(u.force_password_change, false) AS force_password_change,
           w.id as worker_id
    FROM users u
    LEFT JOIN workers w ON u.id = w.user_id AND w.deleted_at IS NULL
    WHERE u.id = $1
  `, [decoded.id]);

  const userDb = userRes.rows[0];

  if (!userDb || userDb.deleted_at) {
    const error = new Error('El usuario no existe o fue eliminado.');
    error.statusCode = 401;
    error.errorCode = 'USER_DELETED';
    throw error;
  }

  if (!userDb.is_active || userDb.status !== 'active') {
    logger.logWarn('AUTH', 'Intento de acceso de usuario desactivado/bloqueado', { user_id: decoded.id });
    const error = new Error('Usuario desactivado. Comuniquese con Recursos Humanos.');
    error.statusCode = 403;
    error.errorCode = 'USER_DISABLED';
    throw error;
  }

  const fallbackRole = decoded.role || decoded.roles?.[0] || 'TRABAJADOR';
  const { roles, permissions } = await resolveUserAccess(userDb.id, fallbackRole, userDb.company_id);

  const authenticatedUser = {
    id: userDb.id,
    company_id: userDb.company_id,
    worker_id: userDb.worker_id,
    email: decoded.email,
    roles,
    permissions,
    sessionId: decoded.sessionId || null,
    forcePasswordChange: userDb.force_password_change === true,
    mustChangePassword: userDb.force_password_change === true,
    passwordChangeRequired: userDb.force_password_change === true
  };

  authenticatedUserCache.set(userDb.id, authenticatedUser);
  return authenticatedUser;
}

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerMatch = typeof authHeader === 'string'
    ? authHeader.match(/^Bearer\s+([^\s]+)$/i)
    : null;
  const token = bearerMatch?.[1];

  if (!token) {
    logger.logWarn('AUTH', 'Intento de acceso sin token', { ip: req.ip, path: req.path });
    return res.status(401).json({
      success: false,
      message: 'Acceso denegado. Proporciona un Bearer token válido.',
      error_code: 'BEARER_TOKEN_REQUIRED',
      code: 'BEARER_TOKEN_REQUIRED',
      errorCode: 'BEARER_TOKEN_REQUIRED'
    });
  }

  jwt.verify(token, env.jwtSecret, async (err, decoded) => {
    if (err) {
      const isExpired = err.name === 'TokenExpiredError';
      logger.logWarn('AUTH', isExpired ? 'Sesion expirada' : 'Token invalido', { ip: req.ip, error: err.message });

      return res.status(401).json({
        success: false,
        message: isExpired ? 'Su sesion ha expirado. Por favor, inicie sesion de nuevo.' : 'Token invalido o expirado.',
        error_code: isExpired ? 'SESSION_EXPIRED' : 'INVALID_TOKEN'
      });
    }

    try {
      await ensureTokenSessionIsActive(decoded);

      const cachedUser = authenticatedUserCache.get(decoded.id);
      if (cachedUser) {
        req.user = { ...cachedUser, sessionId: decoded.sessionId || null };
        req.tenantId = cachedUser.company_id;
        touchAuthenticatedSession(req.user);
        if (enforcePasswordChangeIfRequired(req, res)) return;
        return next();
      }

      if (!pendingAuthenticatedUserLookups.has(decoded.id)) {
        pendingAuthenticatedUserLookups.set(
          decoded.id,
          resolveAuthenticatedUser(decoded).finally(() => pendingAuthenticatedUserLookups.delete(decoded.id))
        );
      }

      const resolvedUser = await pendingAuthenticatedUserLookups.get(decoded.id);
      req.user = { ...resolvedUser, sessionId: decoded.sessionId || null };
      req.tenantId = req.user.company_id;
      touchAuthenticatedSession(req.user);
      if (enforcePasswordChangeIfRequired(req, res)) return;

      next();
    } catch (dbError) {
      if (dbError.statusCode) {
        return res.status(dbError.statusCode).json({
          success: false,
          message: dbError.message,
          error_code: dbError.errorCode,
          code: dbError.errorCode,
          errorCode: dbError.errorCode
        });
      }

      logger.logError('AUTH', 'Error validando sesion', dbError);
      next(dbError);
    }
  });
};

module.exports = { authenticateToken, clearAuthenticatedUserCache };
