const service = require('../services/attendance.service');
const repo = require('../repositories/attendance.repository');
const { logAudit } = require('../../../shared/utils/audit');
const logger = require('../../../shared/utils/logger');
const { query } = require('../../../config/database');
const moment = require('moment-timezone');
const { TIMEZONE, getWorkerShift, getCurrentWorkLocation, serializeAttendanceRecord } = require('../services/mobile-attendance.service');
const {
  buildAttendanceError,
  normalizeAttendanceDate,
  normalizeAttendanceInput,
  normalizeAttendanceRequestBody,
  getAttendanceDayContext,
  resolveAuthenticatedWorker
} = require('../services/attendance-context.util');

// ── Timezone del negocio ──────────────────────────────────────
const BUSINESS_TZ = TIMEZONE;

// ── Helper: resolver worker_id del usuario autenticado ────────
async function resolveWorkerId(req) {
  try {
    const worker = await resolveAuthenticatedWorker(req);
    return worker.workerId;
  } catch (error) {
    if (!isMobileRequest(req) && error?.errorCode === 'WORKER_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

// ── Helper: normalizar registro de asistencia para Flutter ────
function normalizeRecord(record, todayDate, shift) {
  return serializeAttendanceRecord(record, { todayDate, shift });
}

function isMobileRequest(req) {
  return String(req.originalUrl || req.url || '').includes('/api/mobile/');
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function getRequestedAttendanceDate(req) {
  return firstPresent(
    req.body?.attendanceDate,
    req.body?.attendance_date,
    req.body?.date,
    req.query?.attendanceDate,
    req.query?.attendance_date,
    req.query?.date
  ) || null;
}

function getRawAttendanceTime(req, type = 'check_in') {
  const body = req.body || {};
  const typeSpecificValues = type === 'check_out'
    ? [body.checkOutTime, body.check_out_time, body.checkoutTime]
    : [body.checkInTime, body.check_in_time];

  return firstPresent(
    body.attendanceTime,
    body.attendance_time,
    body.time,
    ...typeSpecificValues,
    body.timestamp,
    body.clientTimestamp,
    body.client_timestamp,
    body.markedAt,
    body.marked_at
  ) || null;
}

function getAttendanceDateFromRequest(req, type = 'check_in') {
  const rawAttendanceTime = getRawAttendanceTime(req, type);
  const requestedDate = getRequestedAttendanceDate(req);
  return normalizeAttendanceInput(rawAttendanceTime, {
    fallbackDate: requestedDate,
    timezone: req.body?.timezone || req.query?.timezone || BUSINESS_TZ,
    field: type === 'check_out' ? 'checkOutTime' : 'checkInTime'
  }).date;
}

async function resolveLogicalShiftDate(workerId, companyId, baseDate, timeStr, timezone) {
  if (!workerId || !companyId) return baseDate;
  
  const yesterday = moment.tz(baseDate, 'YYYY-MM-DD', timezone).subtract(1, 'day').format('YYYY-MM-DD');
  
  // Si tiene un check-in abierto de ayer, asume ayer automáticamente para permitir check-out/horas extra.
  const recordYesterday = await repo.getTodayCheckIn(workerId, yesterday, companyId);
  if (recordYesterday && !recordYesterday.check_out_time) {
    return yesterday;
  }

  const shiftYesterday = await getWorkerShift(workerId, companyId, yesterday);
  if (shiftYesterday && shiftYesterday.startTime && shiftYesterday.endTime) {
    if (shiftYesterday.startTime > shiftYesterday.endTime) {
      // It's a night shift that crosses midnight
      // Cutoff: 12:00 PM of the next day (baseDate)
      const noon = moment.tz(`${baseDate} 12:00:00`, 'YYYY-MM-DD HH:mm:ss', timezone);
      const timeMoment = moment.tz(`${baseDate} ${timeStr}`, 'YYYY-MM-DD HH:mm:ss', timezone);
      
      if (timeMoment.isSameOrBefore(noon)) {
        return yesterday;
      }
    }
  }
  
  return baseDate;
}

function enrichTodayAvailability(normalized, dayContext) {
  const hasShift = Boolean(normalized.shift);
  const shift = hasShift ? {
    ...normalized.shift,
    timezone: dayContext.timezone,
    workingDays: normalized.shift?.workingDays || dayContext.workingDaysNumbers,
    workingDaysNames: dayContext.workingDaysNames || dayContext.workingDays,
    working_days: dayContext.workingDaysNames || dayContext.workingDays,
    working_days_numbers: dayContext.workingDaysNumbers
  } : normalized.shift;

  const enriched = {
    ...normalized,
    date: dayContext.date,
    day: dayContext.day,
    timezone: dayContext.timezone,
    isWorkingDay: dayContext.isWorkingDay,
    shift,
    blockReason: null,
    blockMessage: null
  };

  if (!hasShift) {
    enriched.canCheckIn = false;
    if (enriched.status !== 'checked_in') {
      enriched.canCheckOut = false;
      enriched.blockReason = 'SHIFT_NOT_ASSIGNED';
      enriched.blockMessage = 'No tienes un turno asignado para hoy.';
    }
  } else if (!dayContext.isWorkingDay) {
    enriched.canCheckIn = false;
    if (enriched.status !== 'checked_in') {
      enriched.canCheckOut = false;
      enriched.blockReason = 'NON_WORKING_DAY';
      enriched.blockMessage = 'Hoy no es dia laboral para tu turno.';
    }
  }

  // Overtime and Grace Period logic
  if (hasShift && shift.endTime && enriched.status === 'checked_in') {
    const { buildShiftMoments } = require('../services/mobile-attendance.service');
    const shiftMoments = buildShiftMoments(dayContext.date, shift);
    if (shiftMoments) {
      const now = moment().tz(dayContext.timezone);
      const shiftEndTime = shiftMoments.scheduledCheckOut;
      const graceEndTime = shiftEndTime.clone().add(30, 'minutes');
      
      enriched.shiftEndTime = shiftEndTime.format('HH:mm');
      enriched.graceEndTime = graceEndTime.format('HH:mm');
      
      if (enriched.overtimeActive) {
        const maxOT = enriched.maxOvertimeMinutes || 0;
        const overtimeEndTime = shiftEndTime.clone().add(maxOT, 'minutes');
        enriched.overtimeEndTime = overtimeEndTime.format('HH:mm');
        
        if (now.isAfter(shiftEndTime)) {
          enriched.message = `Horas extra activadas hasta las ${enriched.overtimeEndTime}.`;
        }
      } else {
        if (now.isAfter(shiftEndTime) && now.isSameOrBefore(graceEndTime)) {
          enriched.message = "Tu turno termino. Marca tu salida o espera activacion de horas extra.";
        }
      }
    }
  }

  // Clear block messages if they can check out
  if (enriched.status === 'checked_in') {
    enriched.blockReason = null;
    enriched.blockMessage = null;
    enriched.canCheckOut = true;
  }

  return enriched;
}

// ── POST /attendance/check-in ─────────────────────────────────
exports.checkIn = async (req, res, next) => {
  try {
    normalizeAttendanceRequestBody(req);

    console.log('=== CHECK-IN VALIDATION ===');
    console.log('attendanceTime raw:', req.body.attendanceTime);
    console.log('attendanceTime type:', typeof req.body.attendanceTime);
    console.log('attendanceTime length:', req.body.attendanceTime?.length);
    console.log('timestamp:', req.body.timestamp);
    console.log('date:', req.body.date);
    console.log('All body keys:', Object.keys(req.body));
    console.log('===========================');

    console.log('[ATTENDANCE/CHECK-IN] START', {
      user_id: req.user.id,
      company_id: req.tenantId,
      body_keys: Object.keys(req.body || {})
    });

    const workerId = await resolveWorkerId(req);
    const companyId = req.tenantId;

    // Validate workLocationId format before anything else
    const { normalizeWorkLocationId, assertScheduleAllowsAttendance } = require('../services/attendance-context.util');
    normalizeWorkLocationId(req);

    // Validate working day
    let attendanceDate = getAttendanceDateFromRequest(req, 'check_in');
    
    // Resolve logical date for night shifts regardless of what the app sends
    // Get user timezone
    let userTz = 'America/Lima';
    const scheduleService = require('../../schedule-service/services/laborSchedule.service');
    const tempShift = await scheduleService.resolveWorkerSchedule(workerId, companyId, attendanceDate);
    if (tempShift && tempShift.shift && tempShift.shift.timezone) {
      userTz = tempShift.shift.timezone;
    }

    const rawAttendanceTime = getRawAttendanceTime(req, 'check_in');
    const { time: timeStr } = normalizeAttendanceInput(rawAttendanceTime, { fallbackDate: attendanceDate, timezone: userTz });
    attendanceDate = await resolveLogicalShiftDate(workerId, companyId, attendanceDate, timeStr, userTz);
    req.body.date = attendanceDate; // Force service to use logical date

    const schedule = tempShift;
    assertScheduleAllowsAttendance(schedule, attendanceDate);

    const record = await service.checkIn(req);

    await logAudit({
      userId: req.user.id, companyId: req.tenantId,
      module: 'ATTENDANCE', action: 'CHECK_IN',
      entity: 'attendance_records', entityId: record.id, req
    });
    
    const todayDate = record.date ? moment(record.date).format('YYYY-MM-DD') : moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');
    const shift = await getWorkerShift(record.worker_id, req.tenantId, todayDate);
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
    normalizeAttendanceRequestBody(req);
    console.log('[ATTENDANCE/CHECK-OUT] START', {
      user_id: req.user.id,
      company_id: req.tenantId
    });

    const workerId = await resolveWorkerId(req);
    const companyId = req.tenantId;

    // Validate workLocationId format before anything else
    const { normalizeWorkLocationId, assertScheduleAllowsAttendance } = require('../services/attendance-context.util');
    normalizeWorkLocationId(req);

    // Validate working day
    let attendanceDate = getAttendanceDateFromRequest(req, 'check_out');
    
    // Resolve logical date for night shifts regardless of what the app sends
    // Get user timezone
    let userTz = 'America/Lima';
    const scheduleService = require('../../schedule-service/services/laborSchedule.service');
    const tempShift = await scheduleService.resolveWorkerSchedule(workerId, companyId, attendanceDate);
    if (tempShift && tempShift.shift && tempShift.shift.timezone) {
      userTz = tempShift.shift.timezone;
    }

    const rawAttendanceTime = getRawAttendanceTime(req, 'check_out');
    const { time: timeStr } = normalizeAttendanceInput(rawAttendanceTime, { fallbackDate: attendanceDate, timezone: userTz });
    attendanceDate = await resolveLogicalShiftDate(workerId, companyId, attendanceDate, timeStr, userTz);
    req.body.date = attendanceDate; // Force service to use logical date
    
    const schedule = tempShift;
    assertScheduleAllowsAttendance(schedule, attendanceDate);

    const record = await service.checkOut(req);

    await logAudit({
      userId: req.user.id, companyId: req.tenantId,
      module: 'ATTENDANCE', action: 'CHECK_OUT',
      entity: 'attendance_records', entityId: record.id, req
    });

    const todayDate = record.date ? moment(record.date).format('YYYY-MM-DD') : moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');
    const shift = await getWorkerShift(record.worker_id, req.tenantId, todayDate);
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
    res.set('Cache-Control', 'no-store');
    const userId = req.user.id;
    const companyId = req.tenantId;
    const requestedDate = req.query?.date || req.query?.attendance_date || null;
    
    // Default to America/Lima instead of BUSINESS_TZ to avoid UTC desfase
    let userTz = 'America/Lima'; 
    let todayDate = normalizeAttendanceDate(requestedDate, userTz);

    const workerId = await resolveWorkerId(req);

    if (workerId) {
      // Intentamos obtener el shift para ver si tiene su propia timezone
      let shift = await getWorkerShift(workerId, companyId, todayDate);
      if (shift && shift.timezone) {
        userTz = shift.timezone;
        // Recalculamos todayDate con la timezone del usuario
        todayDate = normalizeAttendanceDate(requestedDate, userTz);
      }
    }

    console.log('[ATTENDANCE/TODAY] DEBUG', {
      user_id: userId,
      company_id: companyId,
      today_date: todayDate,
      timezone: userTz
    });

    if (!workerId) {
      return res.json({
        success: true,
        data: normalizeRecord(null, todayDate, null)
      });
    }

    if (!requestedDate) {
      const now = moment().tz(userTz);
      todayDate = await resolveLogicalShiftDate(workerId, companyId, todayDate, now.format('HH:mm:ss'), userTz);
    }

    const shift = await getWorkerShift(workerId, companyId, todayDate);
    const dayContext = getAttendanceDayContext({ date: todayDate, shift });
    todayDate = dayContext.date;
    let currentWorkLocation = null;
    try {
      currentWorkLocation = await getCurrentWorkLocation(workerId, companyId, todayDate);
    } catch (error) {
      if (error?.errorCode !== 'WORK_LOCATION_NOT_ASSIGNED') {
        throw error;
      }
    }
    const record = await repo.getTodayCheckIn(workerId, todayDate, companyId);

    console.log('[attendance/today]', {
      userId,
      workerId,
      companyId,
      attendanceId: record?.id || null,
      attendanceDate: record?.date || null,
      checkIn: record?.check_in_time || null,
      shiftId: shift?.id || null,
      shiftPayload: shift,
      scheduledCheckIn: shift?.startTime || null,
      scheduledCheckOut: shift?.endTime || null,
      toleranceMinutes: shift?.toleranceMinutes ?? null
    });

    if (!record) {
      let normalized = normalizeRecord(null, todayDate, shift);
      normalized = enrichTodayAvailability(normalized, dayContext);
      if (isMobileRequest(req)) {
        normalized.workLocation = currentWorkLocation;
      }
      return res.json({
        success: true,
        data: normalized
      });
    }

    let normalized = normalizeRecord(record, todayDate, shift);
    normalized = enrichTodayAvailability(normalized, dayContext);
    if (isMobileRequest(req)) {
      normalized.workLocation = currentWorkLocation;
    }

    const payload = {
      success: true,
      data: normalized,
      // Legacy compat key
      attendance: {
        status: normalized.status,
        check_in: normalized.checkIn,
        check_out: normalized.checkOut,
        worked_hours: normalized.workedHours,
        date: normalized.date
      }
    };

    console.log('[ATTENDANCE/TODAY] Response:', { status: normalized.status, workedHours: normalized.workedHours });
    return res.json(payload);

  } catch (error) {
    logger.logError('ATTENDANCE', 'Error en getTodayRecord', error);
    next(error);
  }
};

exports.getCurrentWorkLocation = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const userId = req.user.id;
    const companyId = req.tenantId;
    const worker = await resolveAuthenticatedWorker(req);
    const workerId = worker.workerId;
    const targetDate = normalizeAttendanceDate(req.query?.date || req.query?.attendance_date || null, BUSINESS_TZ);

    const workLocation = await getCurrentWorkLocation(workerId, companyId, targetDate);

    console.log('[MOBILE_WORK_LOCATION_CURRENT]', {
      userId,
      workerId,
      companyId,
      date: targetDate,
      workLocationId: workLocation?.workLocationId || null,
      assignmentId: workLocation?.assignment?.id || null,
      hasCoordinates: workLocation?.latitude !== null
        && workLocation?.latitude !== undefined
        && workLocation?.longitude !== null
        && workLocation?.longitude !== undefined,
      allowedRadiusMeters: workLocation?.allowedRadiusMeters || null
    });

    return res.json({
      success: true,
      data: workLocation
    });
  } catch (error) {
    if (error?.errorCode === 'WORK_LOCATION_NOT_ASSIGNED') {
      const built = buildAttendanceError({
        status: 422,
        code: 'WORK_LOCATION_NOT_ASSIGNED',
        message: error.message,
        details: error.details || {}
      });
      return res.status(built.status).json(built.body);
    }
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
      SELECT ar.id, ar.worker_id, ar.company_id, ar.project_id, ar.date,
             ar.status, ar.check_in_time, ar.check_out_time,
             ar.worked_hours, ar.worked_minutes, ar.effective_worked_minutes, ar.late_minutes, ar.overtime_minutes,
             ar.expected_minutes, ar.break_minutes, ar.break_paid, ar.scheduled_check_in, ar.scheduled_check_out,
             ar.check_in_latitude, ar.check_in_longitude,
             ar.check_out_latitude, ar.check_out_longitude,
             COALESCE(wc.agreed_salary, jp.base_salary, 0) AS base_salary
      FROM attendance_records ar
      LEFT JOIN workers w ON w.id = ar.worker_id
      LEFT JOIN job_positions jp ON jp.id = COALESCE(w.position_id, w.job_position_id)
      LEFT JOIN worker_contracts wc ON wc.worker_id = w.id AND wc.status = 'active'
      WHERE ar.worker_id = $1
        AND ar.company_id = $2
        AND ar.date >= $3::date
        AND ar.date <= $4::date
      ORDER BY ar.date DESC, ar.check_in_time DESC
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
    const records = dataResult.rows.map((r) => {
      const normalized = normalizeRecord(r, moment(r.date).format('YYYY-MM-DD'), shift);
      
      const monthlySalary = Number(r.base_salary) || 0;
      const hourlyRate = monthlySalary / 240;
      const effHours = normalized.effective_worked_hours || 0;
      const extraHours = normalized.overtimeHours || 0;
      const ordinaryEarnings = effHours * hourlyRate;
      const overtimeEarnings = extraHours * (hourlyRate * 2);
      const totalEarnings = ordinaryEarnings + overtimeEarnings;

      return {
        ...normalized,
        hourly_rate: Number(hourlyRate.toFixed(2)),
        ordinary_earnings: Number(ordinaryEarnings.toFixed(2)),
        overtime_earnings: Number(overtimeEarnings.toFixed(2)),
        total_earnings: Number(totalEarnings.toFixed(2))
      };
    });
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
          WHEN effective_worked_minutes IS NOT NULL THEN effective_worked_minutes::numeric / 60.0
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
        WHEN effective_worked_minutes IS NOT NULL THEN effective_worked_minutes::numeric / 60.0
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
             worked_hours, worked_minutes, effective_worked_minutes, late_minutes, overtime_minutes,
             expected_minutes, break_minutes, break_paid, scheduled_check_in, scheduled_check_out,
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
             worked_hours, worked_minutes, effective_worked_minutes, late_minutes, overtime_minutes,
             expected_minutes, break_minutes, break_paid, scheduled_check_in, scheduled_check_out,
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

// ── POST /attendance/overtime/activate ───────────────────────
exports.activateOvertime = async (req, res, next) => {
  try {
    const { attendanceId, maxOvertimeMinutes } = req.body;
    
    if (!attendanceId) {
      return res.status(400).json({ success: false, message: 'attendanceId es requerido' });
    }
    
    if (!maxOvertimeMinutes || maxOvertimeMinutes <= 0) {
      return res.status(400).json({ success: false, message: 'maxOvertimeMinutes debe ser un número positivo' });
    }

    const { query } = require('../../../config/database');
    const updateResult = await query(
      `UPDATE attendance_records 
       SET overtime_active = true, 
           max_overtime_minutes = $1, 
           overtime_activated_by = $2, 
           overtime_activated_at = NOW() 
       WHERE id = $3 AND status = 'checked_in'
       RETURNING id`,
      [maxOvertimeMinutes, req.user.id, attendanceId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Registro de asistencia no encontrado o ya cerrado' });
    }

    return res.status(200).json({
      success: true,
      message: 'Horas extra activadas correctamente',
      data: {
        attendanceId,
        maxOvertimeMinutes
      }
    });
  } catch (error) {
    next(error);
  }
};
