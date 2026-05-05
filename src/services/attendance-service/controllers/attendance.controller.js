const service = require('../services/attendance.service');
const { logAudit } = require('../../../shared/utils/audit');
const logger = require('../../../shared/utils/logger');
const { query } = require('../../../config/database');
const moment = require('moment-timezone');

// ── Timezone del negocio ──────────────────────────────────────
const BUSINESS_TZ = 'America/Lima';

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

// ── GET /attendance/today ─────────────────────────────────────
exports.getTodayRecord = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const workerId = req.user.worker_id;
    const companyId = req.tenantId;
    const todayDate = moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');

    // ── Log temporal de diagnóstico ───────────────────────────
    console.log('[ATTENDANCE/TODAY] DEBUG', {
      user_id: userId,
      worker_id: workerId,
      company_id: companyId,
      today_date: todayDate,
      timezone: BUSINESS_TZ,
      server_utc: new Date().toISOString()
    });

    // Si el usuario no tiene worker_id asociado, buscar en DB
    let resolvedWorkerId = workerId;
    if (!resolvedWorkerId) {
      const workerRes = await query(
        'SELECT id FROM workers WHERE user_id = $1 AND company_id = $2 AND deleted_at IS NULL',
        [userId, companyId]
      );
      resolvedWorkerId = workerRes.rows[0]?.id || null;
      console.log('[ATTENDANCE/TODAY] Worker lookup fallback:', { resolvedWorkerId });
    }

    if (!resolvedWorkerId) {
      console.log('[ATTENDANCE/TODAY] No worker profile found → status none');
      return res.json({
        success: true,
        data: {
          status: 'none',
          checkIn: null,
          checkOut: null,
          workedHours: 0,
          date: todayDate
        }
      });
    }

    // Consultar registro de asistencia del día
    const sql = `
      SELECT id, worker_id, company_id, project_id, date,
             status, check_in_time, check_out_time,
             worked_hours, worked_minutes, late_minutes,
             check_in_latitude, check_in_longitude,
             check_out_latitude, check_out_longitude
      FROM attendance_records
      WHERE worker_id = $1
        AND date = $2::date
      ORDER BY check_in_time DESC
      LIMIT 1
    `;
    const params = [resolvedWorkerId, todayDate];

    console.log('[ATTENDANCE/TODAY] Query:', { sql: sql.replace(/\s+/g, ' ').trim(), params });

    const result = await query(sql, params);
    const record = result.rows[0];

    console.log('[ATTENDANCE/TODAY] Record found:', !!record, record ? { id: record.id, status: record.status } : null);

    if (!record) {
      const payload = {
        success: true,
        data: {
          status: 'none',
          checkIn: null,
          checkOut: null,
          workedHours: 0,
          date: todayDate
        }
      };
      console.log('[ATTENDANCE/TODAY] Response (no record):', JSON.stringify(payload));
      return res.json(payload);
    }

    // Determinar status normalizado
    let attendanceStatus;
    if (record.check_out_time) {
      attendanceStatus = 'checked_out';
    } else if (record.check_in_time) {
      attendanceStatus = 'checked_in';
    } else {
      attendanceStatus = 'none';
    }

    // Calcular horas trabajadas
    let workedHours = 0;
    if (record.worked_hours) {
      workedHours = parseFloat(record.worked_hours);
    } else if (record.worked_minutes) {
      workedHours = parseFloat((record.worked_minutes / 60).toFixed(2));
    } else if (record.check_in_time && record.check_out_time) {
      const diffMs = new Date(record.check_out_time) - new Date(record.check_in_time);
      workedHours = parseFloat((diffMs / 3600000).toFixed(2));
    }

    const payload = {
      success: true,
      data: {
        status: attendanceStatus,
        checkIn: record.check_in_time || null,
        checkOut: record.check_out_time || null,
        workedHours,
        date: todayDate,
        // Campos extra útiles para el frontend
        id: record.id,
        lateMinutes: record.late_minutes || 0,
        dbStatus: record.status
      },
      // Clave alternativa para compatibilidad con frontend legacy
      attendance: {
        status: attendanceStatus,
        check_in: record.check_in_time || null,
        check_out: record.check_out_time || null,
        worked_hours: workedHours,
        date: todayDate
      }
    };

    console.log('[ATTENDANCE/TODAY] Response (record found):', JSON.stringify(payload));
    return res.json(payload);

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getTodayRecord', error);
    next(error);
  }
};

// ── GET /attendance/my-records ────────────────────────────────
exports.getMyRecords = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.tenantId;
    let workerId = req.user.worker_id;

    if (!workerId) {
      const workerRes = await query(
        'SELECT id FROM workers WHERE user_id = $1 AND company_id = $2 AND deleted_at IS NULL',
        [userId, companyId]
      );
      workerId = workerRes.rows[0]?.id || null;
    }

    if (!workerId) {
      return res.json({ success: true, data: [], total: 0 });
    }

    const { page = 1, limit = 15, startDate, endDate } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `
      SELECT id, worker_id, date, status, check_in_time, check_out_time,
             worked_hours, worked_minutes, late_minutes, overtime_minutes,
             check_in_latitude, check_in_longitude,
             check_out_latitude, check_out_longitude
      FROM attendance_records
      WHERE worker_id = $1
        AND company_id = $2
    `;
    const params = [workerId, companyId];
    let paramIndex = 3;

    if (startDate) {
      sql += ` AND date >= $${paramIndex}::date`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      sql += ` AND date <= $${paramIndex}::date`;
      params.push(endDate);
      paramIndex++;
    }

    sql += ` ORDER BY date DESC, check_in_time DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    const result = await query(sql, params);

    // Count total
    let countSql = `SELECT COUNT(*) FROM attendance_records WHERE worker_id = $1 AND company_id = $2`;
    const countParams = [workerId, companyId];
    let countIndex = 3;
    if (startDate) {
      countSql += ` AND date >= $${countIndex}::date`;
      countParams.push(startDate);
      countIndex++;
    }
    if (endDate) {
      countSql += ` AND date <= $${countIndex}::date`;
      countParams.push(endDate);
      countIndex++;
    }
    const countResult = await query(countSql, countParams);

    return res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getMyRecords', error);
    next(error);
  }
};
