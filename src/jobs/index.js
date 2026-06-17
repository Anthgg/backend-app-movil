const cron = require('node-cron');
const absenceService = require('../services/attendance-service/services/absence.service');
const logger = require('../shared/utils/logger');
const { query } = require('../config/database');
const moment = require('moment');

// Ejecutar a las 23:59 todos los días
cron.schedule('59 23 * * *', async () => {
  logger.logInfo('CRON', 'Iniciando cronjob de asistencia nocturno...');
  
  try {
    const today = moment().format('YYYY-MM-DD');
    const companiesRes = await query('SELECT id FROM companies');
    
    for (const company of companiesRes.rows) {
      // 1. Cerrar incompletos
      await absenceService.closeIncompleteAttendances(company.id, today);
      
      // 2. Generar faltas
      await absenceService.generateDailyAbsences(company.id, today);
    }
    
    logger.logInfo('CRON', 'Cronjob de asistencia nocturno finalizado con éxito.');
  } catch (error) {
    logger.logError('CRON', 'Error fatal en cronjob nocturno', error);
  }
});

// Auto-Checkout Cron (Cada 5 minutos)
cron.schedule('*/5 * * * *', async () => {
  try {
    const companiesRes = await query('SELECT id FROM companies');
    for (const company of companiesRes.rows) {
      await absenceService.processAutoCheckouts(company.id);
    }
  } catch (error) {
    logger.logError('CRON', 'Error en proceso de auto-checkout', error);
  }
});

const jobFunctions = {
    generateAbsences: (tenantId, targetDate, userId) => absenceService.generateDailyAbsences(tenantId, targetDate, userId),
    closeIncompleteAttendances: (tenantId, targetDate, userId) => absenceService.closeIncompleteAttendances(tenantId, targetDate, userId),
    detectSuspiciousActivities: (tenantId, targetDate, userId) => absenceService.detectSuspiciousActivities(tenantId, targetDate, userId),
    recalculateDailySummaries: (tenantId, targetDate, userId) => absenceService.recalculateDailyAttendance(tenantId, targetDate, userId)
};

const runJob = (jobName) => {
    if (typeof jobFunctions[jobName] !== 'function') {
        throw new Error(`Job '${jobName}' no encontrado.`);
    }
    return jobFunctions[jobName];
};

module.exports = {
    cron,
    runJob
};
