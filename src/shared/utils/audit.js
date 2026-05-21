const { logAuditEvent } = require('../../utils/audit.util');

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
  await logAuditEvent({
    userId,
    companyId,
    module,
    action,
    entity,
    entityId,
    oldData,
    newData,
    req
  });
};

module.exports = { logAudit };
