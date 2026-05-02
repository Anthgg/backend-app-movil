const { query } = require('../../config/database');
const logger = require('./logger');

/**
 * Registra una acción en la base de datos audit_logs
 */
const logAudit = async ({
  userId,
  companyId,
  module,
  action,
  entity,
  entityId,
  oldData = null,
  newData = null,
  req = {} // opcional para extraer IP y user agent
}) => {
  try {
    const ipAddress = req.ip || req.headers?.['x-forwarded-for'] || null;
    const userAgent = req.headers?.['user-agent'] || null;

    await query(`
      INSERT INTO audit_logs (user_id, module, action, entity, entity_id, old_data, new_data, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [userId, module, action, entity, entityId, oldData, newData, ipAddress, userAgent]);

  } catch (error) {
    logger.logError('AUDIT', 'Error guardando audit_log', error, { userId, module, action });
  }
};

module.exports = { logAudit };
