const dashboardRepo = require('./dashboard.repository');
const logger = require('../../shared/utils/logger');

exports.getSummary = async (req, res, next) => {
  try {
    const metrics = await dashboardRepo.getSummaryMetrics(req.tenantId);
    res.json({ success: true, data: metrics });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getSummary', error);
    next(error);
  }
};

exports.getAttendanceToday = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getAttendanceToday(req.tenantId);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getAttendanceToday', error);
    next(error);
  }
};

exports.getWorkerStatus = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getWorkerStatus(req.tenantId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ... otros endpoints de dashboard (pending-requests, contracts-expiring, late-workers, etc.) 
// siguen el mismo patrón llamando a repositorios especializados
