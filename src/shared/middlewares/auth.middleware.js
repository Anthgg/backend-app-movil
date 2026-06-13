const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const logger = require('../utils/logger');
const { query } = require('../../config/database');
const { resolveUserAccess } = require('../utils/authz');
const { createCatalogCache } = require('../utils/catalog-cache');
const sessionService = require('../../services/profile-service/session.service');

const authenticatedUserCache = createCatalogCache(30 * 1000);
const pendingAuthenticatedUserLookups = new Map();

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

async function resolveAuthenticatedUser(decoded) {
  const userRes = await query(`
    SELECT u.id, u.company_id, u.is_active, u.status, u.deleted_at, w.id as worker_id
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
    sessionId: decoded.sessionId || null
  };

  authenticatedUserCache.set(userDb.id, authenticatedUser);
  return authenticatedUser;
}

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.logWarn('AUTH', 'Intento de acceso sin token', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, message: 'Acceso denegado. Token no proporcionado.' });
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
      const cachedUser = authenticatedUserCache.get(decoded.id);
      if (cachedUser) {
        req.user = { ...cachedUser, sessionId: decoded.sessionId || null };
        req.tenantId = cachedUser.company_id;
        touchAuthenticatedSession(req.user);
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

      next();
    } catch (dbError) {
      if (dbError.statusCode) {
        return res.status(dbError.statusCode).json({
          success: false,
          message: dbError.message,
          error_code: dbError.errorCode
        });
      }

      logger.logError('AUTH', 'Error validando sesion', dbError);
      next(dbError);
    }
  });
};

module.exports = { authenticateToken };
