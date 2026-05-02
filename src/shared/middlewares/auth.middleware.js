const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const logger = require('../utils/logger');
const { query } = require('../../config/database');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.logWarn('AUTH', 'Intento de acceso sin token', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, message: 'Acceso denegado. Token no proporcionado.' });
  }

  jwt.verify(token, env.jwtSecret, async (err, decoded) => {
    if (err) {
      logger.logWarn('AUTH', 'Token inválido o expirado', { ip: req.ip, error: err.message });
      return res.status(401).json({ success: false, message: 'Token inválido o expirado.', error_code: 'INVALID_TOKEN' });
    }
    
    try {
      // Obtener usuario, roles, permisos y worker
      const userRes = await query(`
        SELECT u.id, u.company_id, u.is_active, u.status, u.deleted_at, w.id as worker_id
        FROM users u
        LEFT JOIN workers w ON u.id = w.user_id AND w.deleted_at IS NULL
        WHERE u.id = $1
      `, [decoded.id]);
      
      const userDb = userRes.rows[0];

      if (!userDb || userDb.deleted_at) {
        return res.status(401).json({ success: false, message: 'El usuario no existe o fue eliminado.', error_code: 'USER_DELETED' });
      }

      if (!userDb.is_active || userDb.status !== 'active') {
        logger.logWarn('AUTH', 'Intento de acceso de usuario desactivado/bloqueado', { user_id: decoded.id });
        return res.status(403).json({ success: false, message: 'Usuario desactivado. Comuníquese con Recursos Humanos.', error_code: 'USER_DISABLED' });
      }

      // Obtener Roles
      const roleRes = await query(`
        SELECT r.name FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = $1
      `, [userDb.id]);
      const roles = roleRes.rows.map(r => r.name);

      // Obtener Permisos
      const permRes = await query(`
        SELECT p.name FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN user_roles ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = $1
      `, [userDb.id]);
      const permissions = permRes.rows.map(p => p.name);

      req.user = {
        id: userDb.id,
        company_id: userDb.company_id,
        worker_id: userDb.worker_id,
        email: decoded.email,
        roles,
        permissions
      };

      next();
    } catch (dbError) {
      logger.logError('AUTH', 'Error validando sesión', dbError);
      next(dbError);
    }
  });
};

module.exports = { authenticateToken };
