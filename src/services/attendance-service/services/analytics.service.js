const moment = require('moment-timezone');
const { query } = require('../../../config/database');

const TIMEZONE = process.env.TZ || 'America/Lima';
const MAX_RANGE_DAYS = 366;
const STATUS_LABELS = Object.freeze({
  present: 'Asistió',
  late: 'Tardanza',
  absent: 'Falta',
  vacation: 'Vacaciones',
  medical_leave: 'Descanso médico',
  unpaid_leave: 'Permiso personal',
  holiday: 'Feriado',
  rest_day: 'Día de descanso',
  no_schedule: 'Sin horario asignado',
  incomplete: 'Marcación incompleta',
  pending: 'Pendiente'
});
const STATUS_ALIASES = Object.freeze({
  present: 'present',
  presente: 'present',
  late: 'late',
  tardanza: 'late',
  absent: 'absent',
  falta: 'absent',
  vacation: 'vacation',
  vacaciones: 'vacation',
  medical_leave: 'medical_leave',
  descanso_medico: 'medical_leave',
  unpaid_leave: 'unpaid_leave',
  permiso_personal: 'unpaid_leave',
  holiday: 'holiday',
  feriado: 'holiday',
  rest_day: 'rest_day',
  descanso: 'rest_day',
  no_schedule: 'no_schedule',
  sin_horario: 'no_schedule',
  incomplete: 'incomplete',
  incompleto: 'incomplete',
  pending: 'pending',
  pendiente: 'pending'
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createHttpError(statusCode, errorCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * factor) / factor : 0;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? round((Number(numerator || 0) / denominator) * 100) : 0;
}

function normalizeStatus(value) {
  const token = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  return STATUS_ALIASES[token] || null;
}

function normalizeStatuses(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  const normalized = values.map(normalizeStatus).filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeDate(value, field) {
  const parsed = moment.tz(String(value || ''), 'YYYY-MM-DD', true, TIMEZONE);
  if (!parsed.isValid()) {
    throw createHttpError(400, 'INVALID_ANALYTICS_DATE', `${field} debe tener formato YYYY-MM-DD.`, { field, value });
  }
  return parsed.format('YYYY-MM-DD');
}

function parsePeriod(filters = {}, options = {}) {
  if (options.today === true) {
    const date = filters.date
      ? normalizeDate(filters.date, 'date')
      : moment().tz(TIMEZONE).format('YYYY-MM-DD');
    return { startDate: date, endDate: date, month: date.slice(0, 7) };
  }

  if (filters.startDate || filters.start_date || filters.endDate || filters.end_date) {
    const rawStart = filters.startDate || filters.start_date;
    const rawEnd = filters.endDate || filters.end_date;
    if (!rawStart || !rawEnd) {
      throw createHttpError(400, 'ANALYTICS_DATE_RANGE_REQUIRED', 'Debes enviar startDate y endDate juntos.');
    }
    const startDate = normalizeDate(rawStart, 'startDate');
    const endDate = normalizeDate(rawEnd, 'endDate');
    const start = moment.tz(startDate, 'YYYY-MM-DD', TIMEZONE);
    const end = moment.tz(endDate, 'YYYY-MM-DD', TIMEZONE);
    if (end.isBefore(start, 'day')) {
      throw createHttpError(400, 'INVALID_ANALYTICS_DATE_RANGE', 'endDate no puede ser anterior a startDate.');
    }
    const rangeDays = end.diff(start, 'days') + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw createHttpError(422, 'ANALYTICS_RANGE_TOO_LARGE', `El rango máximo es de ${MAX_RANGE_DAYS} días.`, { rangeDays });
    }
    return {
      startDate,
      endDate,
      month: startDate.slice(0, 7) === endDate.slice(0, 7) ? startDate.slice(0, 7) : null
    };
  }

  const month = String(filters.month || moment().tz(TIMEZONE).format('YYYY-MM'));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw createHttpError(400, 'INVALID_ANALYTICS_MONTH', 'month debe tener formato YYYY-MM.', { month });
  }
  const start = moment.tz(`${month}-01`, 'YYYY-MM-DD', TIMEZONE);
  return {
    startDate: start.format('YYYY-MM-DD'),
    endDate: start.clone().endOf('month').format('YYYY-MM-DD'),
    month
  };
}

function parseLimit(value, fallback = 10) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 100);
}

function validateUuid(value, field) {
  if (!UUID_PATTERN.test(String(value || ''))) {
    throw createHttpError(400, 'INVALID_ANALYTICS_FILTER', `${field} debe ser un UUID valido.`, { field, value });
  }
  return value;
}

function buildSqlFilters(filters, params) {
  const clauses = [];
  const mappings = [
    ['workerId', 'worker_id', 'w.id'],
    ['areaId', 'area_id', 'w.area_id'],
    ['departmentId', 'department_id', 'w.internal_department_id'],
    ['positionId', 'position_id', 'COALESCE(w.position_id, w.job_position_id)'],
    ['workLocationId', 'work_location_id', 'w.work_location_id']
  ];

  for (const [camelKey, snakeKey, column] of mappings) {
    const value = filters[camelKey] || filters[snakeKey];
    if (!value) continue;
    params.push(validateUuid(value, camelKey));
    clauses.push(`${column} = $${params.length}::uuid`);
  }

  const crewId = filters.crewId || filters.crew_id;
  if (crewId) {
    params.push(validateUuid(crewId, 'crewId'));
    clauses.push(`EXISTS (
      SELECT 1 FROM crew_workers filter_cw
      WHERE filter_cw.worker_id = w.id
        AND filter_cw.company_id = w.company_id
        AND filter_cw.crew_id = $${params.length}::uuid
        AND filter_cw.assigned_at::date <= $3::date
        AND (filter_cw.unassigned_at IS NULL OR filter_cw.unassigned_at::date >= $2::date)
    )`);
  }

  return clauses;
}

function buildDatasetQuery(companyId, period, filters = {}) {
  const params = [companyId, period.startDate, period.endDate, TIMEZONE];
  const dimensionFilters = buildSqlFilters(filters, params);
  const whereDimensions = dimensionFilters.length ? `AND ${dimensionFilters.join(' AND ')}` : '';

  const sql = `
    WITH base_workers AS (
      SELECT w.id AS worker_id,
             w.company_id,
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name)), ''),
               NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
               u.email,
               w.id::text
             ) AS worker_name,
             COALESCE(w.hire_date, w.start_date, w.created_at::date) AS hire_date,
             w.shift_id AS legacy_shift_id,
             w.area_id,
             a.name AS area_name,
             w.internal_department_id AS department_id,
             d.name AS department_name,
             COALESCE(w.position_id, w.job_position_id) AS position_id,
             jp.name AS position_name,
             w.work_location_id AS base_work_location_id,
             wl.name AS base_work_location_name,
             w.rest_day_type,
             w.fixed_rest_day_of_week,
             EXTRACT(EPOCH FROM w.created_at)::bigint AS worker_created_epoch,
             active_contract.end_date AS contract_end_date
      FROM workers w
      LEFT JOIN users u ON u.id = w.user_id AND u.deleted_at IS NULL
      LEFT JOIN areas a ON a.id = w.area_id AND a.deleted_at IS NULL
      LEFT JOIN departments d ON d.id = w.internal_department_id AND d.deleted_at IS NULL
      LEFT JOIN job_positions jp ON jp.id = COALESCE(w.position_id, w.job_position_id) AND jp.deleted_at IS NULL
      LEFT JOIN work_locations wl ON wl.id = w.work_location_id AND wl.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT wc.end_date
        FROM worker_contracts wc
        WHERE wc.worker_id = w.id
          AND LOWER(COALESCE(wc.status, 'active')) = 'active'
          AND (wc.start_date IS NULL OR wc.start_date <= $3::date)
          AND (wc.end_date IS NULL OR wc.end_date >= $2::date)
        ORDER BY wc.start_date DESC NULLS LAST
        LIMIT 1
      ) active_contract ON TRUE
      WHERE w.company_id = $1
        AND w.deleted_at IS NULL
        AND COALESCE(w.is_active, TRUE) = TRUE
        AND LOWER(COALESCE(w.employment_status, w.status, 'active')) NOT IN ('terminated', 'inactive', 'deleted')
        AND COALESCE(w.hire_date, w.start_date, w.created_at::date) <= $3::date
        ${whereDimensions}
    ), dates AS (
      SELECT generate_series($2::date, $3::date, interval '1 day')::date AS work_date
    ), worker_dates AS (
      SELECT bw.*, dates.work_date
      FROM base_workers bw
      CROSS JOIN dates
      WHERE dates.work_date >= bw.hire_date
        AND (bw.contract_end_date IS NULL OR dates.work_date <= bw.contract_end_date)
    ), resolved AS (
      SELECT wd.*,
             ar.id AS attendance_id,
             ar.status AS raw_status,
             ar.attendance_status AS raw_attendance_status,
             ar.final_status AS raw_final_status,
             ar.check_in_time,
             ar.check_out_time,
             COALESCE(ar.effective_worked_minutes, ar.worked_minutes, 0)::int AS worked_minutes,
             COALESCE(ar.late_minutes, 0)::int AS late_minutes,
             COALESCE(ar.overtime_minutes, 0)::int AS overtime_minutes,
             COALESCE(ar.work_location_id, location_data.work_location_id, wd.base_work_location_id) AS resolved_work_location_id,
             COALESCE(record_wl.name, location_data.work_location_name, wd.base_work_location_name) AS resolved_work_location_name,
             shift_data.shift_id,
             shift_data.working_days,
             shift_data.shift_start_time,
             shift_data.shift_end_time,
             holiday.id AS holiday_id,
             holiday.name AS holiday_name,
             rest_day.id AS rest_day_id,
             leave_data.request_id,
             leave_data.request_type,
             crew_data.crew_id,
             crew_data.crew_name,
             CASE
               WHEN shift_data.shift_id IS NULL THEN FALSE
               WHEN shift_data.working_days IS NULL OR jsonb_array_length(shift_data.working_days) = 0 THEN TRUE
               ELSE EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements_text(shift_data.working_days) item(value)
                 WHERE LOWER(item.value) = LOWER(TO_CHAR(wd.work_date, 'FMDay'))
                    OR CASE LOWER(item.value)
                         WHEN 'lunes' THEN 1 WHEN 'monday' THEN 1
                         WHEN 'martes' THEN 2 WHEN 'tuesday' THEN 2
                         WHEN 'miercoles' THEN 3 WHEN 'miércoles' THEN 3 WHEN 'wednesday' THEN 3
                         WHEN 'jueves' THEN 4 WHEN 'thursday' THEN 4
                         WHEN 'viernes' THEN 5 WHEN 'friday' THEN 5
                         WHEN 'sabado' THEN 6 WHEN 'sábado' THEN 6 WHEN 'saturday' THEN 6
                         WHEN 'domingo' THEN 7 WHEN 'sunday' THEN 7
                         ELSE CASE WHEN item.value ~ '^[1-7]$' THEN item.value::int ELSE 0 END
                       END = EXTRACT(ISODOW FROM wd.work_date)::int
               )
             END AS shift_working_day,
             CASE
               WHEN rest_day.id IS NOT NULL THEN TRUE
               WHEN rest_day.id IS NULL AND wd.rest_day_type = 'fijo'
                 AND wd.fixed_rest_day_of_week = EXTRACT(ISODOW FROM wd.work_date)::int THEN TRUE
               WHEN rest_day.id IS NULL AND wd.rest_day_type = 'rotativo'
                 AND ((wd.worker_created_epoch + EXTRACT(WEEK FROM wd.work_date)::int) % 7) + 1 = EXTRACT(ISODOW FROM wd.work_date)::int THEN TRUE
               ELSE FALSE
             END AS is_rest_day
      FROM worker_dates wd
      LEFT JOIN LATERAL (
        SELECT record.*
        FROM attendance_records record
        WHERE record.worker_id = wd.worker_id
          AND record.company_id = wd.company_id
          AND record.date = wd.work_date
        ORDER BY record.updated_at DESC NULLS LAST, record.created_at DESC NULLS LAST
        LIMIT 1
      ) ar ON TRUE
      LEFT JOIN work_locations record_wl ON record_wl.id = ar.work_location_id AND record_wl.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT wla.work_location_id, assignment_wl.name AS work_location_name
        FROM worker_location_assignments wla
        JOIN work_locations assignment_wl
          ON assignment_wl.id = wla.work_location_id
         AND assignment_wl.company_id = wla.company_id
         AND assignment_wl.deleted_at IS NULL
        WHERE wla.worker_id = wd.worker_id
          AND wla.company_id = wd.company_id
          AND wla.start_date <= wd.work_date
          AND (wla.end_date IS NULL OR wla.end_date >= wd.work_date)
          AND wla.cancelled_at IS NULL
        ORDER BY CASE WHEN wla.assignment_type = 'temporary' THEN 1 ELSE 2 END,
                 wla.start_date DESC,
                 wla.created_at DESC
        LIMIT 1
      ) location_data ON TRUE
      LEFT JOIN LATERAL (
        SELECT candidates.shift_id, candidates.working_days, candidates.shift_start_time, candidates.shift_end_time
        FROM (
          SELECT s.id AS shift_id,
                 s.working_days,
                 s.start_time AS shift_start_time,
                 s.end_time AS shift_end_time,
                 1 AS priority,
                 wsa.effective_from,
                 wsa.created_at
          FROM worker_shift_assignments wsa
          JOIN shifts s ON s.id = wsa.shift_id AND s.company_id = wsa.company_id
          WHERE wsa.worker_id = wd.worker_id
            AND wsa.company_id = wd.company_id
            AND wsa.effective_from <= wd.work_date
            AND (wsa.effective_to IS NULL OR wsa.effective_to >= wd.work_date)
            AND (wsa.is_active = TRUE OR wsa.effective_to IS NOT NULL)
            AND s.deleted_at IS NULL
            AND COALESCE(s.is_active, TRUE) = TRUE

          UNION ALL

          SELECT s.id, s.working_days, s.start_time, s.end_time, 2, NULL::date, NULL::timestamptz
          FROM shifts s
          WHERE s.id = wd.legacy_shift_id
            AND s.company_id = wd.company_id
            AND s.deleted_at IS NULL
            AND COALESCE(s.is_active, TRUE) = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM worker_shift_assignments history
              WHERE history.worker_id = wd.worker_id AND history.company_id = wd.company_id
            )
        ) candidates
        ORDER BY candidates.priority, candidates.effective_from DESC NULLS LAST, candidates.created_at DESC NULLS LAST
        LIMIT 1
      ) shift_data ON TRUE
      LEFT JOIN holidays holiday
        ON holiday.date = wd.work_date
       AND holiday.country = 'PE'
       AND COALESCE(holiday.is_active, TRUE) = TRUE
      LEFT JOIN worker_rest_days rest_day
        ON rest_day.worker_id = wd.worker_id
       AND rest_day.company_id = wd.company_id
       AND rest_day.date = wd.work_date
      LEFT JOIN LATERAL (
        SELECT er.id AS request_id,
               CASE
                 WHEN UPPER(COALESCE(rt.code, rt.name)) IN ('VACATION', 'VAC', 'VACACIONES')
                   OR UPPER(rt.name) IN ('VACATION', 'VACACIONES') THEN 'vacation'
                 WHEN UPPER(COALESCE(rt.code, rt.name)) IN ('MEDICAL_LEAVE', 'MEDICAL', 'DESCANSO_MEDICO')
                   OR UPPER(rt.name) IN ('MEDICAL_LEAVE', 'DESCANSO_MEDICO') THEN 'medical_leave'
                 WHEN UPPER(COALESCE(rt.code, rt.name)) IN ('UNPAID_LEAVE', 'PERSONAL_PERMISSION', 'PERMISO_PERSONAL', 'PERM_001', 'LEAVE_PERMISSION')
                   OR UPPER(rt.name) IN ('UNPAID_LEAVE', 'PERMISO PERSONAL', 'PERMISO_PERSONAL') THEN 'unpaid_leave'
               END AS request_type
        FROM employee_requests er
        JOIN request_types rt ON rt.id = er.request_type_id
        WHERE er.worker_id = wd.worker_id
          AND er.company_id = wd.company_id
          AND er.deleted_at IS NULL
          AND LOWER(er.status) = 'approved'
          AND wd.work_date BETWEEN er.start_date AND er.end_date
          AND COALESCE(rt.affects_attendance, TRUE) = TRUE
        ORDER BY CASE
          WHEN UPPER(COALESCE(rt.code, rt.name)) IN ('VACATION', 'VAC', 'VACACIONES') OR UPPER(rt.name) IN ('VACATION', 'VACACIONES') THEN 1
          WHEN UPPER(COALESCE(rt.code, rt.name)) IN ('MEDICAL_LEAVE', 'MEDICAL', 'DESCANSO_MEDICO') OR UPPER(rt.name) IN ('MEDICAL_LEAVE', 'DESCANSO_MEDICO') THEN 2
          ELSE 3
        END, er.created_at
        LIMIT 1
      ) leave_data ON leave_data.request_type IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT cw.crew_id, wc.name AS crew_name
        FROM crew_workers cw
        JOIN work_crews wc ON wc.id = cw.crew_id AND wc.company_id = cw.company_id AND wc.deleted_at IS NULL
        WHERE cw.worker_id = wd.worker_id
          AND cw.company_id = wd.company_id
          AND cw.assigned_at::date <= wd.work_date
          AND (cw.unassigned_at IS NULL OR cw.unassigned_at::date >= wd.work_date)
          AND (cw.is_active = TRUE OR cw.unassigned_at IS NOT NULL)
        ORDER BY cw.assigned_at DESC, cw.created_at DESC
        LIMIT 1
      ) crew_data ON TRUE
    ), classified AS (
      SELECT resolved.*,
             (shift_id IS NOT NULL AND shift_working_day AND NOT is_rest_day) AS scheduled_day,
             (work_date <= (NOW() AT TIME ZONE $4)::date
               AND shift_id IS NOT NULL AND shift_working_day AND NOT is_rest_day
               AND holiday_id IS NULL AND request_type IS NULL
               AND LOWER(COALESCE(raw_status, raw_final_status, raw_attendance_status, '')) NOT IN (
                 'vacation', 'medical_leave', 'unpaid_leave', 'leave_permission',
                 'holiday', 'rest_day', 'no_schedule'
               )) AS attendance_required,
             CASE
               WHEN request_type IS NOT NULL THEN request_type
               WHEN LOWER(COALESCE(raw_status, raw_final_status, raw_attendance_status, '')) = 'vacation' THEN 'vacation'
               WHEN LOWER(COALESCE(raw_status, raw_final_status, raw_attendance_status, '')) = 'medical_leave' THEN 'medical_leave'
               WHEN LOWER(COALESCE(raw_status, raw_final_status, raw_attendance_status, '')) IN ('unpaid_leave', 'leave_permission') THEN 'unpaid_leave'
               WHEN LOWER(COALESCE(raw_status, raw_final_status, raw_attendance_status, '')) = 'holiday' THEN 'holiday'
               WHEN LOWER(COALESCE(raw_status, raw_final_status, raw_attendance_status, '')) = 'rest_day' THEN 'rest_day'
               WHEN LOWER(COALESCE(raw_status, raw_final_status, raw_attendance_status, '')) = 'no_schedule' THEN 'no_schedule'
               WHEN holiday_id IS NOT NULL THEN 'holiday'
               WHEN shift_id IS NULL THEN 'no_schedule'
               WHEN is_rest_day OR NOT shift_working_day THEN 'rest_day'
               WHEN check_in_time IS NOT NULL AND check_out_time IS NULL THEN 'incomplete'
               WHEN check_in_time IS NOT NULL AND (
                 COALESCE(late_minutes, 0) > 0
                 OR LOWER(COALESCE(raw_status, '')) = 'late'
                 OR LOWER(COALESCE(raw_attendance_status, '')) = 'late'
               ) THEN 'late'
               WHEN check_in_time IS NOT NULL THEN 'present'
               WHEN LOWER(COALESCE(raw_status, raw_final_status, '')) = 'absent' THEN 'absent'
               WHEN work_date < (NOW() AT TIME ZONE $4)::date THEN 'absent'
               ELSE 'pending'
             END AS final_status
      FROM resolved
    )
    SELECT worker_id AS "workerId",
           worker_name AS "workerName",
           work_date::text AS date,
           area_id AS "areaId",
           COALESCE(area_name, 'Sin área') AS "areaName",
           department_id AS "departmentId",
           COALESCE(department_name, 'Sin departamento') AS "departmentName",
           position_id AS "positionId",
           COALESCE(position_name, 'Sin puesto') AS "positionName",
           resolved_work_location_id AS "workLocationId",
           COALESCE(resolved_work_location_name, 'Sin obra') AS "workLocationName",
           crew_id AS "crewId",
           COALESCE(crew_name, 'Sin cuadrilla') AS "crewName",
           final_status AS status,
           scheduled_day AS "scheduledDay",
           attendance_required AS "attendanceRequired",
           (check_in_time IS NOT NULL AND attendance_required) AS "hasAttendance",
           (check_in_time IS NOT NULL AND check_out_time IS NOT NULL AND attendance_required) AS "completedShift",
           (attendance_required AND check_in_time IS NOT NULL AND (
             COALESCE(late_minutes, 0) > 0
             OR LOWER(COALESCE(raw_status, '')) = 'late'
             OR LOWER(COALESCE(raw_attendance_status, '')) = 'late'
           )) AS "isLate",
           worked_minutes AS "workedMinutes",
           late_minutes AS "lateMinutes",
           overtime_minutes AS "overtimeMinutes"
    FROM classified
    ORDER BY work_date, worker_name
  `;

  return { sql, params };
}

function emptyMetrics() {
  return {
    totalWorkers: 0,
    scheduledWorkDays: 0,
    presentCount: 0,
    onTimeCount: 0,
    lateCount: 0,
    absentCount: 0,
    vacationCount: 0,
    medicalLeaveCount: 0,
    unpaidLeaveCount: 0,
    holidayCount: 0,
    restDayCount: 0,
    noScheduleCount: 0,
    incompleteCount: 0,
    pendingCount: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    completedShiftCount: 0
  };
}

function finalizeMetrics(metrics) {
  const presentCount = metrics.presentCount;
  const scheduledWorkDays = metrics.scheduledWorkDays;
  const completedShiftRate = safeRate(metrics.completedShiftCount, presentCount);
  const attendanceRate = safeRate(presentCount, scheduledWorkDays);
  const punctualityRate = safeRate(metrics.onTimeCount, presentCount);
  const absenceRate = safeRate(metrics.absentCount, scheduledWorkDays);
  const lateRate = safeRate(metrics.lateCount, presentCount);
  const averageLateMinutes = metrics.lateCount > 0 ? round(metrics.lateMinutes / metrics.lateCount) : 0;
  const baseScore = attendanceRate * 0.5 + punctualityRate * 0.3 + completedShiftRate * 0.2;
  const score = round(Math.max(
    0,
    Math.min(100, baseScore - metrics.absentCount * 5 - metrics.lateCount * 2 - metrics.incompleteCount)
  ));

  return {
    ...metrics,
    presentOnTimeCount: metrics.onTimeCount,
    workedHours: round(metrics.workedMinutes / 60),
    overtimeHours: round(metrics.overtimeMinutes / 60),
    attendanceRate,
    punctualityRate,
    absenceRate,
    lateRate,
    averageLateMinutes,
    completedShiftRate,
    score
  };
}

function aggregateRows(rows) {
  const metrics = emptyMetrics();
  const workers = new Set();
  for (const row of rows) {
    workers.add(row.workerId);
    if (row.attendanceRequired) metrics.scheduledWorkDays += 1;
    if (row.hasAttendance) metrics.presentCount += 1;
    if (row.hasAttendance && !row.isLate) metrics.onTimeCount += 1;
    if (row.isLate) metrics.lateCount += 1;
    if (row.status === 'absent') metrics.absentCount += 1;
    if (row.status === 'vacation') metrics.vacationCount += 1;
    if (row.status === 'medical_leave') metrics.medicalLeaveCount += 1;
    if (row.status === 'unpaid_leave') metrics.unpaidLeaveCount += 1;
    if (row.status === 'holiday') metrics.holidayCount += 1;
    if (row.status === 'rest_day') metrics.restDayCount += 1;
    if (row.status === 'no_schedule') metrics.noScheduleCount += 1;
    if (row.status === 'incomplete') metrics.incompleteCount += 1;
    if (row.status === 'pending') metrics.pendingCount += 1;
    if (row.completedShift) metrics.completedShiftCount += 1;
    metrics.workedMinutes += Number(row.workedMinutes || 0);
    metrics.lateMinutes += Number(row.lateMinutes || 0);
    metrics.overtimeMinutes += Number(row.overtimeMinutes || 0);
  }
  metrics.totalWorkers = workers.size;
  return finalizeMetrics(metrics);
}

function groupRows(rows, config) {
  const groups = new Map();
  for (const row of rows) {
    const id = row[config.idKey] || null;
    const key = id || `null:${row[config.nameKey]}`;
    if (!groups.has(key)) {
      groups.set(key, { id, name: row[config.nameKey], rows: [] });
    }
    groups.get(key).rows.push(row);
  }

  return [...groups.values()].map((group) => {
    const metrics = aggregateRows(group.rows);
    return {
      [config.outputId]: group.id,
      [config.outputName]: group.name,
      label: group.name,
      scheduledDays: metrics.scheduledWorkDays,
      ...metrics
    };
  });
}

function workerSummaries(rows) {
  const grouped = groupRows(rows, {
    idKey: 'workerId',
    nameKey: 'workerName',
    outputId: 'workerId',
    outputName: 'workerName'
  });
  const firstByWorker = new Map();
  for (const row of rows) {
    if (!firstByWorker.has(row.workerId)) firstByWorker.set(row.workerId, row);
  }
  return grouped.map((item) => {
    const row = firstByWorker.get(item.workerId) || {};
    return {
      ...item,
      areaId: row.areaId || null,
      areaName: row.areaName || 'Sin área',
      departmentId: row.departmentId || null,
      departmentName: row.departmentName || 'Sin departamento',
      positionId: row.positionId || null,
      positionName: row.positionName || 'Sin puesto',
      workLocationId: row.workLocationId || null,
      workLocationName: row.workLocationName || 'Sin obra',
      crewId: row.crewId || null,
      crewName: row.crewName || 'Sin cuadrilla'
    };
  });
}

function rank(items, sorter, mapper, limit = 10) {
  return [...items]
    .sort(sorter)
    .slice(0, limit)
    .map((item, index) => ({ rank: index + 1, ...mapper(item) }));
}

function buildRankings(workers, areas, limit) {
  const topAbsentWorkers = rank(
    workers.filter((item) => item.absentCount > 0),
    (a, b) => b.absentCount - a.absentCount || b.absenceRate - a.absenceRate || a.workerName.localeCompare(b.workerName),
    (item) => ({ ...item, value: item.absentCount, secondaryValue: `${item.absenceRate}% de faltas` }),
    limit
  );
  const topLateWorkers = rank(
    workers.filter((item) => item.lateCount > 0),
    (a, b) => b.lateCount - a.lateCount || b.lateMinutes - a.lateMinutes || a.workerName.localeCompare(b.workerName),
    (item) => ({ ...item, value: item.lateCount, secondaryValue: `${item.lateMinutes} min tarde` }),
    limit
  );
  const bestAttendanceWorkers = rank(
    workers.filter((item) => item.scheduledWorkDays > 0),
    (a, b) => b.score - a.score || b.attendanceRate - a.attendanceRate || a.absentCount - b.absentCount,
    (item) => ({ ...item, value: item.score, secondaryValue: `${item.attendanceRate}% asistencia` }),
    limit
  );
  const topAbsentAreas = rank(
    areas.filter((item) => item.absentCount > 0),
    (a, b) => b.absentCount - a.absentCount || b.absenceRate - a.absenceRate || a.areaName.localeCompare(b.areaName),
    (item) => ({ ...item, value: item.absentCount, secondaryValue: `${item.absenceRate}% de faltas` }),
    limit
  );
  const topLateAreas = rank(
    areas.filter((item) => item.lateCount > 0),
    (a, b) => b.lateCount - a.lateCount || b.lateMinutes - a.lateMinutes || a.areaName.localeCompare(b.areaName),
    (item) => ({ ...item, value: item.lateCount, secondaryValue: `${item.lateMinutes} min tarde` }),
    limit
  );
  return { topAbsentWorkers, topLateWorkers, bestAttendanceWorkers, topAbsentAreas, topLateAreas };
}

function buildDimensionRankings(items, limit) {
  return {
    topAbsences: rank(
      items.filter((item) => item.absentCount > 0),
      (a, b) => b.absentCount - a.absentCount || b.absenceRate - a.absenceRate || a.label.localeCompare(b.label),
      (item) => ({ ...item, value: item.absentCount, secondaryValue: `${item.absenceRate}% de faltas` }),
      limit
    ),
    topLates: rank(
      items.filter((item) => item.lateCount > 0),
      (a, b) => b.lateCount - a.lateCount || b.lateMinutes - a.lateMinutes || a.label.localeCompare(b.label),
      (item) => ({ ...item, value: item.lateCount, secondaryValue: `${item.lateMinutes} min tarde` }),
      limit
    ),
    bestAttendance: rank(
      items.filter((item) => item.scheduledWorkDays > 0),
      (a, b) => b.score - a.score || b.attendanceRate - a.attendanceRate || a.absentCount - b.absentCount,
      (item) => ({ ...item, value: item.score, secondaryValue: `${item.attendanceRate}% asistencia` }),
      limit
    )
  };
}

function buildDailyTrend(rows, period) {
  const grouped = new Map();
  const cursor = moment.tz(period.startDate, 'YYYY-MM-DD', TIMEZONE);
  const end = moment.tz(period.endDate, 'YYYY-MM-DD', TIMEZONE);
  while (cursor.isSameOrBefore(end, 'day')) {
    grouped.set(cursor.format('YYYY-MM-DD'), []);
    cursor.add(1, 'day');
  }
  for (const row of rows) {
    if (!grouped.has(row.date)) grouped.set(row.date, []);
    grouped.get(row.date).push(row);
  }
  return [...grouped.entries()].map(([date, dayRows]) => ({ date, ...aggregateRows(dayRows) }));
}

function buildWeeklyTrend(dailyTrend, period) {
  const start = moment.tz(period.startDate, 'YYYY-MM-DD', TIMEZONE);
  const groups = new Map();
  for (const day of dailyTrend) {
    const index = Math.floor(moment.tz(day.date, 'YYYY-MM-DD', TIMEZONE).diff(start, 'days') / 7) + 1;
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(day);
  }
  return [...groups.entries()].map(([week, days]) => {
    const combined = emptyMetrics();
    for (const day of days) {
      for (const key of Object.keys(combined)) {
        if (key !== 'totalWorkers') combined[key] += Number(day[key] || 0);
      }
      combined.totalWorkers = Math.max(combined.totalWorkers, Number(day.totalWorkers || 0));
    }
    return {
      week,
      startDate: days[0].date,
      endDate: days[days.length - 1].date,
      ...finalizeMetrics(combined)
    };
  });
}

function buildStatusDistribution(metrics) {
  const items = [
    ['present', 'onTimeCount'],
    ['late', 'lateCount'],
    ['absent', 'absentCount'],
    ['vacation', 'vacationCount'],
    ['medical_leave', 'medicalLeaveCount'],
    ['unpaid_leave', 'unpaidLeaveCount'],
    ['holiday', 'holidayCount'],
    ['rest_day', 'restDayCount'],
    ['no_schedule', 'noScheduleCount'],
    ['incomplete', 'incompleteCount'],
    ['pending', 'pendingCount']
  ].map(([key, field]) => ({ key, label: STATUS_LABELS[key], value: Number(metrics[field] || 0) }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item) => ({ ...item, percentage: safeRate(item.value, total) }));
}

function publicFilters(filters, statuses) {
  return {
    areaId: filters.areaId || filters.area_id || null,
    departmentId: filters.departmentId || filters.department_id || null,
    positionId: filters.positionId || filters.position_id || null,
    workerId: filters.workerId || filters.worker_id || null,
    workLocationId: filters.workLocationId || filters.work_location_id || null,
    crewId: filters.crewId || filters.crew_id || null,
    statuses
  };
}

class AttendanceAnalyticsService {
  async getDataset(companyId, filters = {}, options = {}) {
    const period = parsePeriod(filters, options);
    const statuses = normalizeStatuses(filters.status || filters.statuses);
    const built = buildDatasetQuery(companyId, period, filters);
    const result = await query(built.sql, built.params);
    const allRows = result.rows;
    const rows = statuses.length > 0
      ? allRows.filter((row) => statuses.includes(row.status))
      : allRows;
    return { rows, allRows, period, statuses, filters: publicFilters(filters, statuses) };
  }

  summarize(dataset) {
    const metrics = aggregateRows(dataset.rows);
    const scheduledDates = new Set(dataset.rows.filter((row) => row.attendanceRequired).map((row) => row.date));
    return {
      period: dataset.period,
      filters: dataset.filters,
      totalWorkDays: scheduledDates.size,
      ...metrics
    };
  }

  async getToday(companyId, filters = {}) {
    const dataset = await this.getDataset(companyId, filters, { today: true });
    const summary = this.summarize(dataset);
    return {
      date: dataset.period.startDate,
      ...summary,
      scheduledWorkers: summary.scheduledWorkDays,
      statusDistribution: buildStatusDistribution(summary)
    };
  }

  async getMonthly(companyId, filters = {}) {
    const dataset = await this.getDataset(companyId, filters);
    return { month: dataset.period.month, ...this.summarize(dataset), statusDistribution: buildStatusDistribution(aggregateRows(dataset.rows)) };
  }

  async getWorkers(companyId, filters = {}) {
    const dataset = await this.getDataset(companyId, filters);
    return { period: dataset.period, filters: dataset.filters, items: workerSummaries(dataset.rows) };
  }

  async getWorkerSummary(companyId, workerId, filters = {}) {
    const dataset = await this.getDataset(companyId, { ...filters, workerId });
    const item = workerSummaries(dataset.rows)[0] || {
      workerId,
      workerName: null,
      ...finalizeMetrics(emptyMetrics())
    };
    return { ...item, period: dataset.period, statusDistribution: buildStatusDistribution(item) };
  }

  async getGrouping(companyId, filters, grouping) {
    const dataset = await this.getDataset(companyId, filters);
    const configs = {
      areas: { idKey: 'areaId', nameKey: 'areaName', outputId: 'areaId', outputName: 'areaName' },
      departments: { idKey: 'departmentId', nameKey: 'departmentName', outputId: 'departmentId', outputName: 'departmentName' },
      workLocations: { idKey: 'workLocationId', nameKey: 'workLocationName', outputId: 'workLocationId', outputName: 'workLocationName' },
      crews: { idKey: 'crewId', nameKey: 'crewName', outputId: 'crewId', outputName: 'crewName' }
    };
    return { period: dataset.period, filters: dataset.filters, items: groupRows(dataset.rows, configs[grouping]) };
  }

  async getTrend(companyId, filters, interval) {
    const dataset = await this.getDataset(companyId, filters);
    const daily = buildDailyTrend(dataset.rows, dataset.period);
    return {
      period: dataset.period,
      filters: dataset.filters,
      items: interval === 'weekly' ? buildWeeklyTrend(daily, dataset.period) : daily
    };
  }

  async getRankings(companyId, filters = {}) {
    const dataset = await this.getDataset(companyId, filters);
    const workers = workerSummaries(dataset.rows);
    const areas = groupRows(dataset.rows, {
      idKey: 'areaId', nameKey: 'areaName', outputId: 'areaId', outputName: 'areaName'
    });
    const workLocations = groupRows(dataset.rows, {
      idKey: 'workLocationId', nameKey: 'workLocationName', outputId: 'workLocationId', outputName: 'workLocationName'
    });
    const crews = groupRows(dataset.rows, {
      idKey: 'crewId', nameKey: 'crewName', outputId: 'crewId', outputName: 'crewName'
    });
    const limit = parseLimit(filters.limit, 10);
    const workLocationRankings = buildDimensionRankings(workLocations, limit);
    const crewRankings = buildDimensionRankings(crews, limit);
    return {
      period: dataset.period,
      filters: dataset.filters,
      ...buildRankings(workers, areas, limit),
      topAbsentWorkLocations: workLocationRankings.topAbsences,
      topLateWorkLocations: workLocationRankings.topLates,
      bestAttendanceWorkLocations: workLocationRankings.bestAttendance,
      topAbsentCrews: crewRankings.topAbsences,
      topLateCrews: crewRankings.topLates,
      bestAttendanceCrews: crewRankings.bestAttendance
    };
  }

  async getKpis(companyId, filters = {}) {
    const dataset = await this.getDataset(companyId, filters);
    const summary = this.summarize(dataset);
    const workers = workerSummaries(dataset.rows);
    const areas = groupRows(dataset.rows, {
      idKey: 'areaId', nameKey: 'areaName', outputId: 'areaId', outputName: 'areaName'
    });
    const rankings = buildRankings(workers, areas, 1);
    return {
      ...summary,
      bestAttendanceWorker: rankings.bestAttendanceWorkers[0] || null,
      mostLateWorker: rankings.topLateWorkers[0] || null,
      mostAbsentWorker: rankings.topAbsentWorkers[0] || null,
      areaWithMostLates: rankings.topLateAreas[0] || null,
      areaWithMostAbsences: rankings.topAbsentAreas[0] || null
    };
  }

  async getDashboard(companyId, filters = {}) {
    const dataset = await this.getDataset(companyId, filters);
    const kpis = this.summarize(dataset);
    const workers = workerSummaries(dataset.rows);
    const areas = groupRows(dataset.rows, {
      idKey: 'areaId', nameKey: 'areaName', outputId: 'areaId', outputName: 'areaName'
    });
    const departments = groupRows(dataset.rows, {
      idKey: 'departmentId', nameKey: 'departmentName', outputId: 'departmentId', outputName: 'departmentName'
    });
    const workLocations = groupRows(dataset.rows, {
      idKey: 'workLocationId', nameKey: 'workLocationName', outputId: 'workLocationId', outputName: 'workLocationName'
    });
    const crews = groupRows(dataset.rows, {
      idKey: 'crewId', nameKey: 'crewName', outputId: 'crewId', outputName: 'crewName'
    });
    const dailyTrend = buildDailyTrend(dataset.rows, dataset.period);
    const limit = parseLimit(filters.limit, 10);
    const workLocationRankings = buildDimensionRankings(workLocations, limit);
    const crewRankings = buildDimensionRankings(crews, limit);
    const rankings = {
      ...buildRankings(workers, areas, limit),
      topAbsentWorkLocations: workLocationRankings.topAbsences,
      topLateWorkLocations: workLocationRankings.topLates,
      bestAttendanceWorkLocations: workLocationRankings.bestAttendance,
      topAbsentCrews: crewRankings.topAbsences,
      topLateCrews: crewRankings.topLates,
      bestAttendanceCrews: crewRankings.bestAttendance
    };

    return {
      period: dataset.period,
      filters: dataset.filters,
      kpis,
      rankings,
      charts: {
        statusDistribution: buildStatusDistribution(kpis),
        dailyTrend,
        weeklyTrend: buildWeeklyTrend(dailyTrend, dataset.period),
        byArea: areas,
        byDepartment: departments,
        byWorkLocation: workLocations,
        byCrew: crews
      },
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = new AttendanceAnalyticsService();
module.exports.STATUS_LABELS = STATUS_LABELS;
module.exports.normalizeStatus = normalizeStatus;
module.exports.normalizeStatuses = normalizeStatuses;
module.exports.parsePeriod = parsePeriod;
module.exports.validateUuid = validateUuid;
module.exports.safeRate = safeRate;
module.exports.aggregateRows = aggregateRows;
module.exports.groupRows = groupRows;
module.exports.workerSummaries = workerSummaries;
module.exports.buildRankings = buildRankings;
module.exports.buildDimensionRankings = buildDimensionRankings;
module.exports.buildDailyTrend = buildDailyTrend;
module.exports.buildWeeklyTrend = buildWeeklyTrend;
module.exports.buildStatusDistribution = buildStatusDistribution;
