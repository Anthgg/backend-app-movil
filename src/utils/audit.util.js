const { query } = require('../config/database');
const logger = require('../shared/utils/logger');

let auditColumnsCache = null;

async function getAuditColumns(db = { query }) {
  if (auditColumnsCache) {
    return auditColumnsCache;
  }

  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'audit_logs'`
  );

  auditColumnsCache = new Set(result.rows.map((row) => row.column_name));
  return auditColumnsCache;
}

async function logAuditEvent({
  db = { query },
  userId,
  companyId,
  module,
  action,
  entity,
  entityId,
  oldData = null,
  newData = null,
  metadata = null,
  req = {}
}) {
  try {
    const columns = await getAuditColumns(db);
    const ipAddress = req.ip || req.headers?.['x-forwarded-for'] || null;
    const userAgent = req.headers?.['user-agent'] || null;
    const payload = metadata ? { ...(newData || {}), metadata } : newData;

    if (columns.has('company_id')) {
      await db.query(
        `INSERT INTO audit_logs
          (user_id, company_id, module, action, entity, entity_id, old_data, new_data, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [userId, companyId, module, action, entity, entityId, oldData, payload, ipAddress, userAgent]
      );
      return;
    }

    await db.query(
      `INSERT INTO audit_logs
        (user_id, module, action, entity, entity_id, old_data, new_data, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, module, action, entity, entityId, oldData, payload, ipAddress, userAgent]
    );
  } catch (error) {
    logger.logError('AUDIT', 'Error guardando audit_log', error, { userId, module, action });
  }
}

module.exports = {
  logAuditEvent
};
