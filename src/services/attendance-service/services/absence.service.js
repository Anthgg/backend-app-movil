const { query } = require('../../../config/database');
const moment = require('moment');
const logger = require('../../../shared/utils/logger');
const { logAudit } = require('../../../shared/utils/audit');

class AbsenceService {
  
  async generateDailyAbsences(companyId, targetDate, triggeredBy = null) {
    const startTime = Date.now();
    let totalProcessed = 0;
    let absencesGenerated = 0;
    
    try {
      // 1. Obtener todos los trabajadores activos de la empresa
      const workersRes = await query(`
        SELECT w.id, w.user_id, w.company_id, u.is_active as user_active
        FROM workers w
        JOIN users u ON w.user_id = u.id
        WHERE w.company_id = $1 AND w.is_active = true AND w.deleted_at IS NULL
      `, [companyId]);

      const workers = workersRes.rows;
      totalProcessed = workers.length;

      // Por cada trabajador, verificar si hay asistencia o justificación
      for (const worker of workers) {
        if (!worker.user_active) continue;

        // Validar si ya tiene asistencia hoy
        const attRes = await query(`
          SELECT id FROM attendance_records 
          WHERE worker_id = $1 AND date = $2
        `, [worker.id, targetDate]);

        if (attRes.rows.length === 0) {
          // Validar si tiene una solicitud aprobada que justifique este día
          const reqRes = await query(`
            SELECT id FROM employee_requests
            WHERE worker_id = $1 AND status = 'approved' AND $2 >= start_date AND $2 <= end_date
          `, [worker.id, targetDate]);

          if (reqRes.rows.length > 0) {
            // Está justificado (vacaciones, descanso médico, etc), no generamos falta
            continue;
          }

          // No tiene asistencia ni solicitud aprobada. Insertamos falta
          await query(`
            INSERT INTO attendance_records (
              worker_id, company_id, status, 
              incomplete_reason, auto_closed, auto_closed_at, date
            ) VALUES ($1, $2, 'absent', 'No registró asistencia', true, NOW(), $3)
            ON CONFLICT (worker_id, date) DO NOTHING
          `, [worker.id, companyId, targetDate]);

          absencesGenerated++;
        }
      }

      const durationMs = Date.now() - startTime;
      
      // Registrar Job Run
      await query(`
        INSERT INTO job_runs (company_id, job_name, status, started_at, finished_at, duration_ms, triggered_by, target_date, total_processed, total_success)
        VALUES ($1, 'generateDailyAbsencesJob', 'success', TO_TIMESTAMP($2 / 1000.0), NOW(), $3, $4, $5, $6, $7)
      `, [companyId, startTime, durationMs, triggeredBy, targetDate, totalProcessed, absencesGenerated]);

      logger.logChange('ATTENDANCE_JOB', 'Faltas generadas exitosamente', { companyId, date: targetDate, absencesGenerated });
      return { success: true, absencesGenerated };

    } catch (error) {
      logger.logError('ATTENDANCE_JOB', 'Error generando faltas', error);
      
      await query(`
        INSERT INTO job_runs (company_id, job_name, status, started_at, finished_at, duration_ms, triggered_by, target_date, total_processed, error_message)
        VALUES ($1, 'generateDailyAbsencesJob', 'failed', TO_TIMESTAMP($2 / 1000.0), NOW(), $3, $4, $5, $6, $7)
      `, [companyId, startTime, Date.now() - startTime, triggeredBy, targetDate, totalProcessed, error.message]);

      throw error;
    }
  }

  async closeIncompleteAttendances(companyId, targetDate, triggeredBy = null) {
    const startTime = Date.now();
    try {
      const res = await query(`
        UPDATE attendance_records 
        SET status = 'incomplete', incomplete_reason = 'No registró salida', auto_closed = true, auto_closed_at = NOW(), updated_at = NOW()
        WHERE company_id = $1 AND date = $2 AND check_out_time IS NULL AND status != 'absent'
        RETURNING id
      `, [companyId, targetDate]);

      const closedCount = res.rows.length;
      const durationMs = Date.now() - startTime;

      await query(`
        INSERT INTO job_runs (company_id, job_name, status, started_at, finished_at, duration_ms, triggered_by, target_date, total_success)
        VALUES ($1, 'closeIncompleteAttendancesJob', 'success', TO_TIMESTAMP($2 / 1000.0), NOW(), $3, $4, $5, $6)
      `, [companyId, startTime, durationMs, triggeredBy, targetDate, closedCount]);

      return { success: true, closedCount };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new AbsenceService();
