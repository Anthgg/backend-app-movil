const cron = require('node-cron');
const absenceService = require('../services/attendance-service/services/absence.service');
const logger = require('../shared/utils/logger');
const { query } = require('../config/database');
const moment = require('moment');

// Ejecutar a las 23:59 todos los días (Hora Perú)
cron.schedule('59 23 * * *', async () => {
  logger.logInfo('CRON', 'Iniciando cronjob de asistencia nocturno...');
  
  try {
    const today = moment().tz('America/Lima').format('YYYY-MM-DD');
    const yesterday = moment().tz('America/Lima').subtract(1, 'day').format('YYYY-MM-DD');
    const companiesRes = await query('SELECT id FROM companies');
    
    for (const company of companiesRes.rows) {
      // 1. Ejecutar auto-salida antes de clasificar registros incompletos.
      await absenceService.processAutoCheckouts(company.id);

      // 2. Cerrar solo pendientes del día anterior. Esto evita cortar a las
      // 23:59 los turnos nocturnos que terminan al día siguiente.
      await absenceService.closeIncompleteAttendances(company.id, yesterday);
      
      // 3. Generar faltas del día y completar las de turnos nocturnos de ayer.
      await absenceService.generateDailyAbsences(company.id, today);
      await absenceService.generateDailyAbsences(company.id, yesterday);
    }
    
    logger.logInfo('CRON', 'Cronjob de asistencia nocturno finalizado con éxito.');
  } catch (error) {
    logger.logError('CRON', 'Error fatal en cronjob nocturno', error);
  }
}, { timezone: 'America/Lima' });

// Auto-Checkout Cron (Cada 5 minutos)
cron.schedule('*/5 * * * *', async () => {
  try {
    const companiesRes = await query('SELECT id FROM companies');
    const today = moment().tz('America/Lima').format('YYYY-MM-DD');
    const yesterday = moment().tz('America/Lima').subtract(1, 'day').format('YYYY-MM-DD');
    for (const company of companiesRes.rows) {
      await absenceService.processAutoCheckouts(company.id);
      await absenceService.generateDailyAbsences(company.id, today, null);
      await absenceService.generateDailyAbsences(company.id, yesterday, null);
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
