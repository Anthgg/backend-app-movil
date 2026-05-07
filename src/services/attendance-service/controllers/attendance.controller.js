const service = require('../services/attendance.service');
const repo = require('../repositories/attendance.repository');
const { logAudit } = require('../../../shared/utils/audit');
const logger = require('../../../shared/utils/logger');
const { query } = require('../../../config/database');
const moment = require('moment-timezone');
const { TIMEZONE, getWorkerShift, serializeAttendanceRecord } = require('../services/mobile-attendance.service');

// ── Timezone del negocio ──────────────────────────────────────
const BUSINESS_TZ = TIMEZONE;

// ── Helper: resolver worker_id del usuario autenticado ────────
async function resolveWorkerId(req) {
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
  return workerId;
}

// ── Helper: normalizar registro de asistencia para Flutter ────
function normalizeRecord(record, todayDate, shift) {
  return serializeAttendanceRecord(record, { todayDate, shift });
}

// ── POST /attendance/check-in ─────────────────────────────────
exports.checkIn = async (req, res, next) => {
  try {
    console.log('[ATTENDANCE/CHECK-IN] START', {
      user_id: req.user.id,
      company_id: req.tenantId,
      body_keys: Object.keys(req.body || {})
    });

    const record = await service.checkIn(req);

    await logAudit({
      userId: req.user.id, companyId: req.tenantId,
      module: 'ATTENDANCE', action: 'CHECK_IN',
      entity: 'attendance_records', entityId: record.id, req
    });
    
    const todayDate = moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');
    const shift = await getWorkerShift(record.worker_id, req.tenantId);
    const normalized = normalizeRecord(record, todayDate, shift);

    console.log('[ATTENDANCE/CHECK-IN] SUCCESS', { id: record.id, status: normalized.status });

    res.status(201).json({
      success: true,
      message: 'Entrada registrada correctamente',
      data: {
        attendance: normalized
      }
    });
  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en CheckIn', error);

    // Si es error de duplicado, devolver 409 con attendance actual
    if (error.message && error.message.includes('Ya existe')) {
      const todayDate = moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');
      try {
        const workerId = await resolveWorkerId(req);
        if (workerId) {
          const existing = await query(
            `SELECT * FROM attendance_records WHERE worker_id = $1 AND date = $2::date LIMIT 1`,
            [workerId, todayDate]
          );
          if (existing.rows[0]) {
            const shift = await getWorkerShift(workerId, req.tenantId);
            return res.status(409).json({
              success: false,
              message: 'Entrada ya registrada',
              error_code: 'ATTENDANCE_ALREADY_REGISTERED',
              data: {
                attendance: normalizeRecord(existing.rows[0], todayDate, shift)
              }
            });
          }
        }
      } catch (lookupErr) {
        // ignore lookup error, fall through to generic error
      }
      return res.status(409).json({
        success: false,
        message: error.message,
        error_code: 'ATTENDANCE_ALREADY_REGISTERED'
      });
    }

    next(error);
  }
};

// ── POST /attendance/check-out ────────────────────────────────
exports.checkOut = async (req, res, next) => {
  try {
    console.log('[ATTENDANCE/CHECK-OUT] START', {
      user_id: req.user.id,
      company_id: req.tenantId
    });

    const record = await service.checkOut(req);

    await logAudit({
      userId: req.user.id, companyId: req.tenantId,
      module: 'ATTENDANCE', action: 'CHECK_OUT',
      entity: 'attendance_records', entityId: record.id, req
    });

    const todayDate = moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');
    const shift = await getWorkerShift(record.worker_id, req.tenantId);
    const normalized = normalizeRecord(record, todayDate, shift);

    console.log('[ATTENDANCE/CHECK-OUT] SUCCESS', {
      id: record.id, status: normalized.status, workedHours: normalized.workedHours
    });

    res.json({
      success: true,
      message: 'Salida registrada correctamente',
      data: {
        attendance: normalized
      }
    });
  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en CheckOut', error);

    // Si ya tiene salida o no hay entrada
    if (error.message && error.message.includes('Ya se registró la salida')) {
      return res.status(409).json({
        success: false,
        message: error.message,
        error_code: 'CHECK_OUT_ALREADY_EXISTS'
      });
    }
    if (error.message && error.message.includes('No existe check-in')) {
      return res.status(400).json({
        success: false,
        message: error.message,
        error_code: 'CHECK_IN_NOT_FOUND'
      });
    }

    next(error);
  }
};

// ── GET /attendance/today ─────────────────────────────────────
exports.getTodayRecord = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.tenantId;
    const todayDate = moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');

    console.log('[ATTENDANCE/TODAY] DEBUG', {
      user_id: userId,
      company_id: companyId,
      today_date: todayDate,
      timezone: BUSINESS_TZ
    });

    const workerId = await resolveWorkerId(req);

    if (!workerId) {
      return res.json({
        success: true,
        data: normalizeRecord(null, todayDate, null)
      });
    }

    const shift = await getWorkerShift(workerId, companyId);
    const record = await repo.getTodayCheckIn(workerId, todayDate);

    console.log('[ATTENDANCE/TODAY] Record found:', !!record);

    if (!record) {
      return res.json({
        success: true,
        data: normalizeRecord(null, todayDate, shift)
      });
    }

    const normalized = normalizeRecord(record, todayDate, shift);

    const payload = {
      success: true,
      data: normalized,
      // Legacy compat key
      attendance: {
        status: normalized.status,
        check_in: normalized.checkIn,
        check_out: normalized.checkOut,
        worked_hours: normalized.workedHours,
        date: todayDate
      }
    };

    console.log('[ATTENDANCE/TODAY] Response:', { status: normalized.status, workedHours: normalized.workedHours });
    return res.json(payload);

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getTodayRecord', error);
    next(error);
  }
};

// ── GET /attendance/history?month=MM&year=YYYY ────────────────
exports.getHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.tenantId;
    const workerId = await resolveWorkerId(req);

    // Parse month/year from query params
    const now = moment().tz(BUSINESS_TZ);
    const month = parseInt(req.query.month) || (now.month() + 1);
    const year = parseInt(req.query.year) || now.year();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    console.log('[ATTENDANCE/HISTORY] DEBUG', {
      user_id: userId,
      company_id: companyId,
      worker_id: workerId,
      month, year, page, limit,
      timezone: BUSINESS_TZ
    });

    if (!workerId) {
      return res.json({
        success: true,
        data: { records: [], total: 0, month, year }
      });
    }

    // Build date range for the requested month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');

    const sql = `
      SELECT id, worker_id, company_id, project_id, date,
             status, check_in_time, check_out_time,
             worked_hours, worked_minutes, late_minutes, overtime_minutes,
             check_in_latitude, check_in_longitude,
             check_out_latitude, check_out_longitude
      FROM attendance_records
      WHERE worker_id = $1
        AND company_id = $2
        AND date >= $3::date
        AND date <= $4::date
      ORDER BY date DESC, check_in_time DESC
      LIMIT $5 OFFSET $6
    `;

    const countSql = `
      SELECT COUNT(*) FROM attendance_records
      WHERE worker_id = $1 AND company_id = $2
        AND date >= $3::date AND date <= $4::date
    `;

    console.log('[ATTENDANCE/HISTORY] Query:', { workerId, companyId, startDate, endDate });

    const [dataResult, countResult] = await Promise.all([
      query(sql, [workerId, companyId, startDate, endDate, limit, offset]),
      query(countSql, [workerId, companyId, startDate, endDate])
    ]);

    const shift = await getWorkerShift(workerId, companyId);
    const records = dataResult.rows.map((r) => normalizeRecord(r, moment(r.date).format('YYYY-MM-DD'), shift));
    const total = parseInt(countResult.rows[0].count);

    console.log('[ATTENDANCE/HISTORY] Found:', { count: records.length, total });

    return res.json({
      success: true,
      data: {
        records,
        total,
        month,
        year,
        page,
        limit
      },
      // Alternative top-level keys for Flutter compat
      records
    });

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getHistory', error);
    next(error);
  }
};

// ── GET /attendance/summary ───────────────────────────────────
exports.getSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.tenantId;
    const workerId = await resolveWorkerId(req);

    const now = moment().tz(BUSINESS_TZ);
    const month = parseInt(req.query.month) || (now.month() + 1);
    const year = parseInt(req.query.year) || now.year();

    console.log('[ATTENDANCE/SUMMARY] DEBUG', {
      user_id: userId, company_id: companyId, worker_id: workerId, month, year
    });

    if (!workerId) {
      return res.json({
        success: true,
        data: {
          totalWorkedHours: 0,
          totalWorkedDays: 0,
          attendancesThisMonth: 0,
          workedDaysThisMonth: 0,
          workedHoursThisMonth: '0.00',
          overtimeHoursThisMonth: '0.00',
          lateCount: 0,
          absenceCount: 0,
          weeklyWorkedHours: 0,
          month, year
        }
      });
    }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');

    // Weekly range (current week Mon-Sun)
    const weekStart = now.clone().startOf('isoWeek').format('YYYY-MM-DD');
    const weekEnd = now.clone().endOf('isoWeek').format('YYYY-MM-DD');

    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) AS total_days,
        COALESCE(SUM(CASE
          WHEN worked_hours IS NOT NULL THEN worked_hours::numeric
          WHEN worked_minutes IS NOT NULL THEN worked_minutes::numeric / 60.0
          WHEN check_in_time IS NOT NULL AND check_out_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 3600.0
          ELSE 0
        END), 0) AS total_hours,
        COALESCE(SUM(COALESCE(overtime_minutes, 0)), 0) AS overtime_minutes,
        COUNT(*) FILTER (WHERE status = 'late') AS late_count,
        COUNT(*) FILTER (WHERE status = 'absent') AS absence_count
      FROM attendance_records
      WHERE worker_id = $1
        AND company_id = $2
        AND date >= $3::date
        AND date <= $4::date
    `;

    const weeklySql = `
      SELECT COALESCE(SUM(CASE
        WHEN worked_hours IS NOT NULL THEN worked_hours::numeric
        WHEN worked_minutes IS NOT NULL THEN worked_minutes::numeric / 60.0
        WHEN check_in_time IS NOT NULL AND check_out_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 3600.0
        ELSE 0
      END), 0) AS weekly_hours
      FROM attendance_records
      WHERE worker_id = $1
        AND company_id = $2
        AND date >= $3::date
        AND date <= $4::date
    `;

    const [monthResult, weekResult] = await Promise.all([
      query(sql, [workerId, companyId, startDate, endDate]),
      query(weeklySql, [workerId, companyId, weekStart, weekEnd])
    ]);

    const monthData = monthResult.rows[0];
    const weekData = weekResult.rows[0];

    const payload = {
      success: true,
      data: {
        totalWorkedHours: parseFloat(parseFloat(monthData.total_hours).toFixed(2)),
        totalWorkedDays: parseInt(monthData.total_days),
        attendancesThisMonth: parseInt(monthData.total_days),
        workedDaysThisMonth: parseInt(monthData.total_days),
        workedHoursThisMonth: parseFloat(parseFloat(monthData.total_hours).toFixed(2)).toFixed(2),
        overtimeHoursThisMonth: (parseFloat(monthData.overtime_minutes || 0) / 60).toFixed(2),
        lateCount: parseInt(monthData.late_count),
        absenceCount: parseInt(monthData.absence_count),
        weeklyWorkedHours: parseFloat(parseFloat(weekData.weekly_hours).toFixed(2)),
        month,
        year
      }
    };

    console.log('[ATTENDANCE/SUMMARY] Response:', payload.data);
    return res.json(payload);

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getSummary', error);
    next(error);
  }
};

// ── GET /attendance/my-records ────────────────────────────────
exports.getMyRecords = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.tenantId;
    let workerId = await resolveWorkerId(req);

    // Si se envía worker_id en query y tiene permiso para ver otros registros
    const queryWorkerId = req.query.worker_id || req.query.workerId;
    if (queryWorkerId && req.user.permissions?.includes('attendance.read')) {
      workerId = queryWorkerId;
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
             check_out_latitude, check_out_longitude, project_id
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

    const shift = await getWorkerShift(workerId, companyId);
    const records = result.rows.map((r) => normalizeRecord(r, moment(r.date).format('YYYY-MM-DD'), shift));

    return res.json({
      success: true,
      data: records,
      records, // compat key
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getMyRecords', error);
    next(error);
  }
};

exports.getWorkerRecords = async (req, res, next) => {
  try {
    const companyId = req.tenantId;
    const workerId = req.params.workerId || req.params.id; // Soporta ambos formatos
    
    if (!workerId) {
      return res.status(400).json({ success: false, message: 'ID de trabajador requerido' });
    }

    const { page = 1, limit = 15, startDate, endDate } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `
      SELECT id, worker_id, date, status, check_in_time, check_out_time,
             worked_hours, worked_minutes, late_minutes, overtime_minutes,
             check_in_latitude, check_in_longitude,
             check_out_latitude, check_out_longitude, project_id
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
    const countRes = await query(`SELECT COUNT(*) FROM attendance_records WHERE worker_id = $1 AND company_id = $2`, [workerId, companyId]);

    const shift = await getWorkerShift(workerId, companyId);
    const records = result.rows.map((r) => normalizeRecord(r, moment(r.date).format('YYYY-MM-DD'), shift));

    res.json({
      success: true,
      data: records,
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getWorkerRecords', error);
    next(error);
  }
};

exports.getToday = exports.getTodayRecord;
exports.getMonthSummary = exports.getSummary;
