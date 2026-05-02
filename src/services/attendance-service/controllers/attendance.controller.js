const service = require('../services/attendance.service');
const { logAudit } = require('../../../shared/utils/audit');
const logger = require('../../../shared/utils/logger');

exports.checkIn = async (req, res, next) => {
  try {
    const record = await service.checkIn(req);
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'ATTENDANCE', action: 'CHECK_IN', entity: 'attendance_records', entityId: record.id, req });
    logger.logChange('ATTENDANCE', 'Check-in registrado', { workerId: record.worker_id, status: record.status });
    res.json({ success: true, data: record });
  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en CheckIn', error);
    next(error);
  }
};

exports.checkOut = async (req, res, next) => {
  try {
    const record = await service.checkOut(req);
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'ATTENDANCE', action: 'CHECK_OUT', entity: 'attendance_records', entityId: record.id, req });
    logger.logChange('ATTENDANCE', 'Check-out registrado', { workerId: record.worker_id });
    res.json({ success: true, data: record });
  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en CheckOut', error);
    next(error);
  }
};
