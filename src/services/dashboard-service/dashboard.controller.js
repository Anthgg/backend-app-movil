const dashboardRepo = require('./dashboard.repository');
const logger = require('../../shared/utils/logger');
const { query } = require('../../config/database');

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

exports.getPendingRequests = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getPendingRequests(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getPendingRequests', error);
    next(error);
  }
};

exports.getContractsExpiring = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getContractsExpiring(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getContractsExpiring', error);
    next(error);
  }
};

exports.getDocumentsPending = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getDocumentsPending(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getDocumentsPending', error);
    next(error);
  }
};

exports.getLateWorkers = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getLateWorkers(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getLateWorkers', error);
    next(error);
  }
};

exports.getProjectSummary = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getProjectSummary(req.tenantId);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getProjectSummary', error);
    next(error);
  }
};

exports.getBirthdays = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getBirthdays(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getBirthdays', error);
    next(error);
  }
};

exports.getAlerts = async (req, res, next) => {
  try {
    const data = await dashboardRepo.getAlerts(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getAlerts', error);
    next(error);
  }
};

exports.getWorkerHome = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.tenantId;

    // Obtener worker_id
    const workerRes = await query(
      'SELECT id FROM workers WHERE user_id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [userId, companyId]
    );
    const workerId = workerRes.rows[0]?.id;

    if (!workerId) {
      return res.status(404).json({ success: false, message: 'Perfil de trabajador no encontrado' });
    }

    const data = await dashboardRepo.getWorkerHomeData(userId, companyId, workerId);
    logger.logInfo('DASHBOARD', 'Worker home birthdays resolved', {
      userId,
      companyId,
      birthDate: data.user?.birthDate || null,
      isBirthday: data.user?.isBirthday || false,
      birthdaysTodayCount: data.birthdays?.today?.length || 0,
      birthdaysUpcomingCount: data.birthdays?.upcoming?.length || 0
    });
    res.json({ success: true, data });
  } catch (error) {
    logger.logError('DASHBOARD', 'Error en getWorkerHome', error);
    next(error);
  }
};
