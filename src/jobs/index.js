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

const jobFunctions = {
    generateAbsences: absenceService.generateDailyAbsences,
    closeIncompleteAttendances: absenceService.closeIncompleteAttendances,
    detectSuspiciousActivities: async (tenantId, params, userId) => {
        // Placeholder for suspicious activity detection logic
        logger.logInfo('JOB', `Running detectSuspiciousActivities for tenant ${tenantId}`);
        return { detected: 0, flagged: 0 };
    },
    recalculateDailySummaries: async (tenantId, params, userId) => {
        // Placeholder for recalculation logic
        logger.logInfo('JOB', `Running recalculateDailySummaries for tenant ${tenantId} with params`, params);
        return { recalculated_days: 1, workers_affected: 5 };
    }
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
