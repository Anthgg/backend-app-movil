const moment = require('moment-timezone');
const ExcelJS = require('exceljs');
const { query } = require('../../../config/database');
const { generateCorporatePdf } = require('../../pdf/pdf-generator.service');
const { loadAsset } = require('../../../utils/pdf-assets.util');

const TIMEZONE = process.env.TZ || 'America/Lima';
const MAX_RANGE_DAYS = 366;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
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
             w.user_id,
             COALESCE(w.document_number, w.personal_id) AS document_number,
             w.profile_photo_url AS worker_profile_photo_url,
             u.profile_photo_url AS user_profile_photo_url,
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name)), ''),
               NULLIF(TRIM(u.full_name), ''),
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
             ar.check_in_latitude,
             ar.check_in_longitude,
             ar.check_out_latitude,
             ar.check_out_longitude,
             ar.check_in_photo_url,
             ar.check_out_photo_url,
             COALESCE(ar.incomplete_reason, ar.suspicious_reason) AS observation,
             COALESCE(ar.effective_worked_minutes, ar.worked_minutes, 0)::int AS worked_minutes,
             COALESCE(ar.late_minutes, 0)::int AS late_minutes,
             COALESCE(ar.overtime_minutes, 0)::int AS overtime_minutes,
             COALESCE(ar.work_location_id, location_data.work_location_id, wd.base_work_location_id) AS resolved_work_location_id,
             COALESCE(record_wl.name, location_data.work_location_name, wd.base_work_location_name) AS resolved_work_location_name,
             shift_data.shift_id,
             shift_data.shift_name,
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
        SELECT candidates.shift_id, candidates.shift_name, candidates.working_days, candidates.shift_start_time, candidates.shift_end_time
        FROM (
          SELECT s.id AS shift_id,
                 s.name AS shift_name,
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

          SELECT s.id, s.name, s.working_days, s.start_time, s.end_time, 2, NULL::date, NULL::timestamptz
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
           user_id AS "userId",
           worker_name AS "workerName",
           worker_name AS "fullName",
           document_number AS "documentNumber",
           COALESCE(worker_profile_photo_url, user_profile_photo_url) AS "profilePhotoUrl",
           COALESCE(worker_profile_photo_url, user_profile_photo_url) AS "photoUrl",
           COALESCE(worker_profile_photo_url, user_profile_photo_url) AS "avatarUrl",
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
           UPPER(final_status) AS "statusCode",
           COALESCE(shift_name, 'Sin turno') AS "shiftName",
           check_in_time AS "checkIn",
           check_out_time AS "checkOut",
           COALESCE(check_in_latitude, check_out_latitude) AS latitude,
           COALESCE(check_in_longitude, check_out_longitude) AS longitude,
           COALESCE(check_in_photo_url, check_out_photo_url) AS "evidencePhotoUrl",
           observation,
           (holiday_id IS NOT NULL) AS "isHoliday",
           holiday_name AS "holidayName",
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
  const statusDatesByWorker = new Map();
  for (const row of rows) {
    if (!firstByWorker.has(row.workerId)) firstByWorker.set(row.workerId, row);
    if (!statusDatesByWorker.has(row.workerId)) {
      statusDatesByWorker.set(row.workerId, { lastLateAt: null, lastAbsenceAt: null });
    }
    const dates = statusDatesByWorker.get(row.workerId);
    if ((row.status === 'late' || row.isLate) && (!dates.lastLateAt || row.date > dates.lastLateAt)) {
      dates.lastLateAt = row.date;
    }
    if (row.status === 'absent' && (!dates.lastAbsenceAt || row.date > dates.lastAbsenceAt)) {
      dates.lastAbsenceAt = row.date;
    }
  }
  return grouped.map((item) => {
    const row = firstByWorker.get(item.workerId) || {};
    const statusDates = statusDatesByWorker.get(item.workerId) || {};
    return {
      ...item,
      label: item.workerName,
      fullName: item.workerName,
      userId: row.userId || null,
      documentNumber: row.documentNumber || null,
      profilePhotoUrl: row.profilePhotoUrl || null,
      photoUrl: row.photoUrl || row.profilePhotoUrl || null,
      avatarUrl: row.avatarUrl || row.profilePhotoUrl || null,
      areaId: row.areaId || null,
      areaName: row.areaName || 'Sin área',
      departmentId: row.departmentId || null,
      departmentName: row.departmentName || 'Sin departamento',
      positionId: row.positionId || null,
      positionName: row.positionName || 'Sin puesto',
      workLocationId: row.workLocationId || null,
      workLocationName: row.workLocationName || 'Sin obra',
      crewId: row.crewId || null,
      crewName: row.crewName || 'Sin cuadrilla',
      lastLateAt: statusDates.lastLateAt || null,
      lastAbsenceAt: statusDates.lastAbsenceAt || null
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
  const bestPunctualityWorkers = rank(
    workers.filter((item) => item.presentCount > 0),
    (a, b) => b.punctualityRate - a.punctualityRate || a.lateCount - b.lateCount || a.workerName.localeCompare(b.workerName),
    (item) => ({ ...item, value: item.punctualityRate, secondaryValue: `${item.lateCount} tardanzas` }),
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
  const bestAttendanceAreas = rank(
    areas.filter((item) => item.scheduledWorkDays > 0),
    (a, b) => b.score - a.score || b.attendanceRate - a.attendanceRate || a.absentCount - b.absentCount,
    (item) => ({ ...item, value: item.score, secondaryValue: `${item.attendanceRate}% asistencia` }),
    limit
  );
  return {
    topAbsentWorkers,
    topLateWorkers,
    bestAttendanceWorkers,
    bestPunctualityWorkers,
    topAbsentAreas,
    topLateAreas,
    bestAttendanceAreas
  };
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
  return [...grouped.entries()].map(([date, dayRows]) => ({
    key: date,
    date,
    label: formatDayLabel(date),
    ...aggregateRows(dayRows)
  }));
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
      key: `week-${week}`,
      week,
      label: `Semana ${week}`,
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

function formatPeriodKey(period) {
  return period.month || `${period.startDate}_${period.endDate}`;
}

function formatDayLabel(date) {
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const parsed = moment.tz(date, 'YYYY-MM-DD', TIMEZONE);
  if (!parsed.isValid()) return String(date || '');
  return `${parsed.format('DD')} ${monthNames[parsed.month()]}`;
}

function parsePage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parsePageSize(value, fallback = DEFAULT_PAGE_SIZE) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
}

function parseSortDirection(value) {
  return String(value || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function toSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function filterBySearch(items, search, fields) {
  const term = toSearchText(search).trim();
  if (!term) return items;
  return items.filter((item) => fields.some((field) => toSearchText(item[field]).includes(term)));
}

function sortItems(items, sortBy, sortDirection, aliases = {}) {
  const field = aliases[sortBy] || sortBy || 'fullName';
  const direction = parseSortDirection(sortDirection);
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return String(a.fullName || a.label || '').localeCompare(String(b.fullName || b.label || ''));
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * multiplier;
    return String(av).localeCompare(String(bv), 'es', { sensitivity: 'base' }) * multiplier;
  });
}

function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function buildTableItems(summaries) {
  return summaries.map((item) => ({
    workerId: item.workerId,
    userId: item.userId || null,
    fullName: item.fullName || item.workerName || item.label,
    documentNumber: item.documentNumber || null,
    profilePhotoUrl: item.profilePhotoUrl || null,
    photoUrl: item.photoUrl || item.profilePhotoUrl || null,
    avatarUrl: item.avatarUrl || item.profilePhotoUrl || null,
    areaId: item.areaId || null,
    areaName: item.areaName || 'Sin área',
    positionId: item.positionId || null,
    positionName: item.positionName || 'Sin puesto',
    departmentId: item.departmentId || null,
    departmentName: item.departmentName || 'Sin departamento',
    workLocationId: item.workLocationId || null,
    workLocationName: item.workLocationName || 'Sin obra',
    crewId: item.crewId || null,
    crewName: item.crewName || 'Sin cuadrilla',
    attendedDays: item.presentCount || 0,
    absentDays: item.absentCount || 0,
    lateDays: item.lateCount || 0,
    vacationDays: item.vacationCount || 0,
    unpaidLeaveDays: item.unpaidLeaveCount || 0,
    medicalLeaveDays: item.medicalLeaveCount || 0,
    attendanceRate: item.attendanceRate || 0,
    punctualityRate: item.punctualityRate || 0,
    lateMinutes: item.lateMinutes || 0,
    workedMinutes: item.workedMinutes || 0
  }));
}

function buildTableResponse(dataset, filters = {}) {
  const page = parsePage(filters.page);
  const pageSize = parsePageSize(filters.pageSize || filters.page_size);
  const sortBy = filters.sortBy || filters.sort_by || 'fullName';
  const sortDirection = filters.sortDirection || filters.sort_direction || 'asc';
  const items = buildTableItems(workerSummaries(dataset.rows));
  const searched = filterBySearch(items, filters.search, [
    'fullName',
    'documentNumber',
    'areaName',
    'positionName',
    'departmentName',
    'workLocationName',
    'crewName'
  ]);
  const sorted = sortItems(searched, sortBy, sortDirection, {
    workerName: 'fullName',
    attendedDays: 'attendedDays',
    absentDays: 'absentDays',
    lateDays: 'lateDays',
    vacationDays: 'vacationDays',
    unpaidLeaveDays: 'unpaidLeaveDays',
    medicalLeaveDays: 'medicalLeaveDays',
    attendanceRate: 'attendanceRate',
    punctualityRate: 'punctualityRate',
    lateMinutes: 'lateMinutes',
    workedMinutes: 'workedMinutes'
  });
  return {
    period: formatPeriodKey(dataset.period),
    dateRange: dataset.period,
    filters: dataset.filters,
    items: paginate(sorted, page, pageSize),
    total: sorted.length,
    page,
    pageSize
  };
}

function pickWorkerInfo(rows, workerId) {
  const row = rows[0] || {};
  return {
    workerId,
    userId: row.userId || null,
    fullName: row.fullName || row.workerName || null,
    documentNumber: row.documentNumber || null,
    profilePhotoUrl: row.profilePhotoUrl || null,
    photoUrl: row.photoUrl || row.profilePhotoUrl || null,
    avatarUrl: row.avatarUrl || row.profilePhotoUrl || null,
    positionId: row.positionId || null,
    positionName: row.positionName || 'Sin puesto',
    areaId: row.areaId || null,
    areaName: row.areaName || 'Sin área',
    departmentId: row.departmentId || null,
    departmentName: row.departmentName || 'Sin departamento',
    workLocationId: row.workLocationId || null,
    workLocationName: row.workLocationName || 'Sin obra',
    crewId: row.crewId || null,
    crewName: row.crewName || 'Sin cuadrilla',
    currentStatus: toStatusCode((rows.filter((item) => item.date <= moment().tz(TIMEZONE).format('YYYY-MM-DD')).sort((a, b) => a.date.localeCompare(b.date)).pop() || row).status)
  };
}

function toStatusCode(status) {
  return String(status || 'pending').toUpperCase();
}

function buildWorkerSummary(metrics) {
  return {
    attendedDays: metrics.presentCount || 0,
    absentDays: metrics.absentCount || 0,
    lateDays: metrics.lateCount || 0,
    lateMinutes: metrics.lateMinutes || 0,
    workedMinutes: metrics.workedMinutes || 0,
    overtimeMinutes: metrics.overtimeMinutes || 0,
    vacationDays: metrics.vacationCount || 0,
    unpaidLeaveDays: metrics.unpaidLeaveCount || 0,
    medicalLeaveDays: metrics.medicalLeaveCount || 0,
    attendanceRate: metrics.attendanceRate || 0,
    punctualityRate: metrics.punctualityRate || 0
  };
}

function buildWorkerCalendar(rows) {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({
    date: row.date,
    status: toStatusCode(row.status),
    label: STATUS_LABELS[row.status] || toStatusCode(row.status),
    checkIn: row.checkIn || null,
    checkOut: row.checkOut || null,
    lateMinutes: Number(row.lateMinutes || 0),
    workedMinutes: Number(row.workedMinutes || 0),
    locationName: row.workLocationName || null,
    latitude: row.latitude === undefined ? null : row.latitude,
    longitude: row.longitude === undefined ? null : row.longitude,
    evidencePhotoUrl: row.evidencePhotoUrl || null,
    observation: row.observation || null,
    isWorkingDay: Boolean(row.scheduledDay),
    isHoliday: Boolean(row.isHoliday || row.status === 'holiday'),
    holidayName: row.holidayName || null,
    shiftName: row.shiftName || null
  }));
}

function buildWorkerDetailResponse(dataset, workerId) {
  const sourceRows = dataset.allRows.length > 0 ? dataset.allRows : dataset.rows;
  if (sourceRows.length === 0) {
    throw createHttpError(404, 'ANALYTICS_WORKER_NOT_FOUND', 'No se encontró el trabajador para el tenant actual.', { workerId });
  }
  const metrics = aggregateRows(dataset.rows);
  return {
    period: formatPeriodKey(dataset.period),
    dateRange: dataset.period,
    filters: dataset.filters,
    worker: pickWorkerInfo(sourceRows, workerId),
    summary: buildWorkerSummary(metrics),
    calendar: buildWorkerCalendar(dataset.rows)
  };
}

function entityConfig(type) {
  const configs = {
    area: { idKey: 'areaId', nameKey: 'areaName', outputId: 'areaId', outputName: 'areaName', filterKey: 'areaId', label: 'area' },
    workLocation: { idKey: 'workLocationId', nameKey: 'workLocationName', outputId: 'workLocationId', outputName: 'workLocationName', filterKey: 'workLocationId', label: 'workLocation' },
    crew: { idKey: 'crewId', nameKey: 'crewName', outputId: 'crewId', outputName: 'crewName', filterKey: 'crewId', label: 'crew' }
  };
  return configs[type] || null;
}

function buildAggregateDetailResponse(dataset, type, entityId, limit = 10) {
  const config = entityConfig(type);
  const sourceRow = (dataset.allRows.length > 0 ? dataset.allRows : dataset.rows)[0] || {};
  const metrics = aggregateRows(dataset.rows);
  const workers = workerSummaries(dataset.rows);
  const rankings = buildRankings(workers, [], limit);
  const dailyTrend = buildDailyTrend(dataset.rows, dataset.period);
  return {
    period: formatPeriodKey(dataset.period),
    dateRange: dataset.period,
    filters: dataset.filters,
    entity: {
      id: entityId,
      name: sourceRow[config.nameKey] || null,
      type
    },
    summary: {
      totalWorkers: metrics.totalWorkers || 0,
      presentCount: metrics.presentCount || 0,
      lateCount: metrics.lateCount || 0,
      absentCount: metrics.absentCount || 0,
      vacationCount: metrics.vacationCount || 0,
      medicalLeaveCount: metrics.medicalLeaveCount || 0,
      unpaidLeaveCount: metrics.unpaidLeaveCount || 0,
      attendanceRate: metrics.attendanceRate || 0,
      punctualityRate: metrics.punctualityRate || 0,
      absenceRate: metrics.absenceRate || 0
    },
    trend: dailyTrend,
    statusDistribution: buildStatusDistribution(metrics),
    topAbsentWorkers: rankings.topAbsentWorkers,
    topLateWorkers: rankings.topLateWorkers,
    bestAttendanceWorkers: rankings.bestAttendanceWorkers
  };
}

const EXPORT_LABELS = Object.freeze({
  section: 'Sección',
  metric: 'Métrica',
  key: 'Clave',
  label: 'Etiqueta',
  value: 'Valor',
  percentage: 'Porcentaje',
  rank: 'Ranking',
  workerId: 'ID trabajador',
  userId: 'ID usuario',
  fullName: 'Trabajador',
  documentNumber: 'Documento',
  areaName: 'Área',
  positionName: 'Puesto',
  departmentName: 'Departamento',
  workLocationName: 'Obra / sede',
  crewName: 'Cuadrilla',
  secondaryValue: 'Detalle',
  attendedDays: 'Días asistidos',
  absentDays: 'Faltas',
  lateDays: 'Tardanzas',
  vacationDays: 'Vacaciones',
  unpaidLeaveDays: 'Permisos',
  medicalLeaveDays: 'Descansos médicos',
  workedMinutes: 'Min. trabajados',
  totalWorkers: 'Trabajadores',
  totalWorkDays: 'Días laborales',
  scheduledWorkDays: 'Días programados',
  presentCount: 'Asistencias',
  onTimeCount: 'Puntuales',
  presentOnTimeCount: 'Asistencias puntuales',
  lateCount: 'Tardanzas',
  absentCount: 'Faltas',
  vacationCount: 'Vacaciones',
  medicalLeaveCount: 'Descansos médicos',
  unpaidLeaveCount: 'Permisos',
  holidayCount: 'Feriados',
  restDayCount: 'Días de descanso',
  noScheduleCount: 'Sin horario',
  incompleteCount: 'Incompletos',
  pendingCount: 'Pendientes',
  workedHours: 'Horas trabajadas',
  lateMinutes: 'Min. tardanza',
  overtimeMinutes: 'Min. extra',
  overtimeHours: 'Horas extra',
  attendanceRate: 'Tasa asistencia',
  punctualityRate: 'Tasa puntualidad',
  absenceRate: 'Tasa faltas',
  lateRate: 'Tasa tardanzas',
  averageLateMinutes: 'Prom. min. tardanza',
  completedShiftRate: 'Turnos completos',
  score: 'Score',
  date: 'Fecha',
  status: 'Estado',
  checkIn: 'Entrada',
  checkOut: 'Salida',
  locationName: 'Ubicación',
  shiftName: 'Turno'
});

const EXPORT_SCOPE_KEYS = Object.freeze({
  dashboard: ['section', 'rank', 'metric', 'key', 'label', 'value', 'secondaryValue', 'attendanceRate', 'punctualityRate'],
  table: [
    'fullName', 'documentNumber', 'areaName', 'positionName', 'departmentName', 'workLocationName', 'crewName',
    'attendedDays', 'absentDays', 'lateDays', 'vacationDays', 'unpaidLeaveDays', 'medicalLeaveDays',
    'attendanceRate', 'punctualityRate', 'lateMinutes', 'workedMinutes'
  ],
  worker: ['date', 'status', 'label', 'checkIn', 'checkOut', 'lateMinutes', 'workedMinutes', 'locationName', 'shiftName'],
  aggregate: ['section', 'rank', 'metric', 'key', 'label', 'value', 'secondaryValue', 'attendanceRate', 'punctualityRate']
});

function normalizeHexColor(value, fallback = '#1E3A8A') {
  const raw = String(value || fallback).trim();
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-f]{6}$/i.test(withHash) ? withHash.toUpperCase() : fallback.toUpperCase();
}

function hexToArgb(value, fallback = '#1E3A8A') {
  return `FF${normalizeHexColor(value, fallback).replace('#', '').toUpperCase()}`;
}

function detectImageExtension(buffer, logoUrl = '') {
  if (buffer?.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer?.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (/\.jpe?g($|\?)/i.test(logoUrl)) return 'jpeg';
  return 'png';
}

function humanizeKey(key) {
  return EXPORT_LABELS[key] || String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getExportKeys(rows, scope) {
  const preferred = EXPORT_SCOPE_KEYS[scope] || EXPORT_SCOPE_KEYS.aggregate;
  const present = new Set(rows.flatMap((row) => Object.keys(row || {})));
  const preferredPresent = preferred.filter((key) => present.has(key));
  const extra = [...present].filter((key) => !preferred.includes(key));
  return preferredPresent.length > 0 ? [...preferredPresent, ...extra] : [...present];
}

function buildExportColumns(rows, scope) {
  const keys = getExportKeys(rows, scope);
  const widthByKey = {
    fullName: 32,
    documentNumber: 16,
    areaName: 24,
    positionName: 24,
    departmentName: 24,
    workLocationName: 28,
    crewName: 22,
    secondaryValue: 24,
    checkIn: 23,
    checkOut: 23,
    locationName: 26,
    shiftName: 22,
    label: 24,
    value: 16
  };
  const ratio = keys.length > 0 ? round(1 / keys.length, 4) : 1;
  return keys.map((key) => ({
    key,
    label: humanizeKey(key),
    width: widthByKey[key] || Math.min(Math.max(humanizeKey(key).length + 6, 14), 26),
    widthRatio: ratio
  }));
}

function getCompanyDisplayName(companyConfig = {}) {
  return companyConfig.legalName
    || companyConfig.razon_social
    || companyConfig.commercialName
    || companyConfig.nombre_comercial
    || companyConfig.companyName
    || companyConfig.company_name
    || 'Empresa';
}

function getCompanyLogoUrl(companyConfig = {}) {
  return companyConfig.logoUrl || companyConfig.logo_url || companyConfig.company_logo_url || null;
}

function normalizeCompanyConfig(row = {}) {
  const legalName = row.razon_social || row.company_name || 'Empresa';
  const commercialName = row.nombre_comercial || row.company_name || legalName;
  return {
    ...row,
    legalName,
    commercialName,
    ruc: row.ruc || row.company_ruc || null,
    fiscalAddress: row.direccion_fiscal || row.company_address || null,
    email: row.correo_corporativo || null,
    phone: row.telefono || null,
    website: row.pagina_web || null,
    logoUrl: row.logo_url || row.company_logo_url || null,
    signatureUrl: row.firma_url || null,
    stampUrl: row.sello_url || null,
    legalRepresentativeName: row.representante_legal || null,
    legalRepresentativeRole: row.cargo_representante || null,
    colorPrimario: row.color_primario || '#1E3A8A',
    colorSecundario: row.color_secundario || '#3B82F6',
    colorTexto: row.color_texto || '#0F172A'
  };
}

async function getCompanyExportConfig(companyId) {
  const result = await query(`
    SELECT c.name AS company_name,
           c.ruc AS company_ruc,
           c.logo_url AS company_logo_url,
           c.address AS company_address,
           cs.razon_social,
           cs.nombre_comercial,
           cs.ruc,
           cs.direccion_fiscal,
           cs.telefono,
           cs.correo_corporativo,
           cs.pagina_web,
           cs.representante_legal,
           cs.cargo_representante,
           cs.logo_url,
           cs.firma_url,
           cs.sello_url,
           cs.color_primario,
           cs.color_secundario,
           cs.color_texto
    FROM companies c
    LEFT JOIN company_settings cs
      ON cs.company_id = c.id
     AND COALESCE(cs.estado, TRUE) = TRUE
    WHERE c.id = $1
      AND c.deleted_at IS NULL
    LIMIT 1
  `, [companyId]);

  return normalizeCompanyConfig(result.rows[0] || {});
}

function exportFilters(filters = {}, period = null) {
  return {
    period: period ? formatPeriodKey(period) : filters.month || null,
    startDate: filters.startDate || filters.start_date || period?.startDate || null,
    endDate: filters.endDate || filters.end_date || period?.endDate || null,
    workerId: filters.workerId || filters.worker_id || null,
    areaId: filters.areaId || filters.area_id || null,
    departmentId: filters.departmentId || filters.department_id || null,
    positionId: filters.positionId || filters.position_id || null,
    workLocationId: filters.workLocationId || filters.work_location_id || null,
    crewId: filters.crewId || filters.crew_id || null,
    status: filters.status || filters.statuses || null,
    search: filters.search || null
  };
}

function compactObject(object = {}) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function dashboardSummaryCards(kpis = {}) {
  return {
    Trabajadores: kpis.totalWorkers || 0,
    'Asistencia %': `${kpis.attendanceRate || 0}%`,
    'Puntualidad %': `${kpis.punctualityRate || 0}%`,
    Faltas: kpis.absentCount || 0,
    Tardanzas: kpis.lateCount || 0
  };
}

function workerSummaryCards(summary = {}) {
  return {
    Asistidos: summary.attendedDays || 0,
    Faltas: summary.absentDays || 0,
    Tardanzas: summary.lateDays || 0,
    Vacaciones: summary.vacationDays || 0,
    'Asistencia %': `${summary.attendanceRate || 0}%`
  };
}

function aggregateSummaryCards(summary = {}) {
  return {
    Trabajadores: summary.totalWorkers || 0,
    Presentes: summary.presentCount || 0,
    Faltas: summary.absentCount || 0,
    Tardanzas: summary.lateCount || 0,
    'Asistencia %': `${summary.attendanceRate || 0}%`
  };
}

function buildInfoSections({ scope, period, rowCount, entity = null, worker = null }) {
  const baseRows = [
    { label: 'Periodo', value: period },
    { label: 'Filas', value: rowCount },
    { label: 'Alcance', value: scope }
  ];
  if (worker) {
    baseRows.push({ label: 'Trabajador', value: worker.fullName || worker.workerId });
    baseRows.push({ label: 'Documento', value: worker.documentNumber || '-' });
  }
  if (entity) {
    baseRows.push({ label: 'Entidad', value: entity.name || entity.id });
    baseRows.push({ label: 'Tipo', value: entity.type });
  }
  return [{
    title: 'Información del reporte',
    rows: baseRows
  }];
}

const EXPORT_FORMAT_OPTIONS = Object.freeze([
  { key: 'xlsx', label: 'Excel corporativo', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', corporate: true },
  { key: 'pdf', label: 'PDF corporativo', mimeType: 'application/pdf', corporate: true },
  { key: 'csv', label: 'CSV plano', mimeType: 'text/csv; charset=utf-8', corporate: false }
]);

const EXPORT_SCOPE_OPTIONS = Object.freeze([
  { key: 'dashboard', label: 'Dashboard completo', requires: [] },
  { key: 'table', label: 'Tabla analítica', requires: [] },
  { key: 'worker', label: 'Detalle de trabajador', requires: ['workerId'] },
  { key: 'area', label: 'Detalle de área', requires: ['areaId'] },
  { key: 'workLocation', label: 'Detalle de obra/sede', requires: ['workLocationId'] },
  { key: 'crew', label: 'Detalle de cuadrilla', requires: ['crewId'] }
]);

const EXPORT_TABLE_SORT_OPTIONS = Object.freeze([
  { key: 'fullName', label: 'Trabajador' },
  { key: 'areaName', label: 'Área' },
  { key: 'workLocationName', label: 'Obra / sede' },
  { key: 'attendedDays', label: 'Días asistidos' },
  { key: 'absentDays', label: 'Faltas' },
  { key: 'lateDays', label: 'Tardanzas' },
  { key: 'vacationDays', label: 'Vacaciones' },
  { key: 'medicalLeaveDays', label: 'Descansos médicos' },
  { key: 'unpaidLeaveDays', label: 'Permisos' },
  { key: 'attendanceRate', label: 'Tasa asistencia' },
  { key: 'punctualityRate', label: 'Tasa puntualidad' }
]);

function statusFilterOptions() {
  return Object.entries(STATUS_LABELS).map(([key, label]) => ({
    key: key.toUpperCase(),
    value: key,
    label
  }));
}

function buildSearchClause(search, columns, params) {
  const value = String(search || '').trim();
  if (!value) return '';
  params.push(`%${value}%`);
  const placeholder = `$${params.length}`;
  return `AND (${columns.map((column) => `COALESCE(${column}::text, '') ILIKE ${placeholder}`).join(' OR ')})`;
}

async function queryCatalog(sql, params, mapper = (row) => row) {
  const result = await query(sql, params);
  return result.rows.map(mapper);
}

async function getExportFilterCatalogs(companyId, filters = {}) {
  const optionLimit = parseLimit(filters.optionLimit || filters.option_limit || filters.limit, 100);
  const search = filters.search || '';

  const workerParams = [companyId, optionLimit];
  const workerSearch = buildSearchClause(search, [
    "w.document_number",
    "w.personal_id",
    "w.first_name",
    "w.paternal_last_name",
    "w.maternal_last_name",
    "u.full_name",
    "u.email"
  ], workerParams);

  const dimensionParams = [companyId, optionLimit];
  const areaSearch = buildSearchClause(search, ['a.name'], dimensionParams);
  const departmentParams = [companyId, optionLimit];
  const departmentSearch = buildSearchClause(search, ['d.name'], departmentParams);
  const positionParams = [companyId, optionLimit];
  const positionSearch = buildSearchClause(search, ['jp.name'], positionParams);
  const workLocationParams = [companyId, optionLimit];
  const workLocationSearch = buildSearchClause(search, ['wl.name'], workLocationParams);
  const crewParams = [companyId, optionLimit];
  const crewSearch = buildSearchClause(search, ['wc.name'], crewParams);

  const [workers, areas, departments, positions, workLocations, crews] = await Promise.all([
    queryCatalog(`
      SELECT w.id AS "workerId",
             w.user_id AS "userId",
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name)), ''),
               NULLIF(TRIM(u.full_name), ''),
               NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
               u.email,
               w.id::text
             ) AS "fullName",
             COALESCE(w.document_number, w.personal_id) AS "documentNumber",
             COALESCE(w.profile_photo_url, u.profile_photo_url) AS "avatarUrl",
             w.area_id AS "areaId",
             a.name AS "areaName",
             w.internal_department_id AS "departmentId",
             d.name AS "departmentName",
             COALESCE(w.position_id, w.job_position_id) AS "positionId",
             jp.name AS "positionName",
             w.work_location_id AS "workLocationId",
             wl.name AS "workLocationName"
      FROM workers w
      LEFT JOIN users u ON u.id = w.user_id AND u.deleted_at IS NULL
      LEFT JOIN areas a ON a.id = w.area_id AND a.deleted_at IS NULL
      LEFT JOIN departments d ON d.id = w.internal_department_id AND d.deleted_at IS NULL
      LEFT JOIN job_positions jp ON jp.id = COALESCE(w.position_id, w.job_position_id) AND jp.deleted_at IS NULL
      LEFT JOIN work_locations wl ON wl.id = w.work_location_id AND wl.deleted_at IS NULL
      WHERE w.company_id = $1
        AND w.deleted_at IS NULL
        AND COALESCE(w.is_active, TRUE) = TRUE
        ${workerSearch}
      ORDER BY "fullName"
      LIMIT $2
    `, workerParams),
    queryCatalog(`
      SELECT a.id AS "areaId", a.name AS "areaName"
      FROM areas a
      WHERE a.company_id = $1 AND a.deleted_at IS NULL ${areaSearch}
      ORDER BY a.name
      LIMIT $2
    `, dimensionParams),
    queryCatalog(`
      SELECT d.id AS "departmentId", d.name AS "departmentName"
      FROM departments d
      WHERE d.company_id = $1 AND d.deleted_at IS NULL ${departmentSearch}
      ORDER BY d.name
      LIMIT $2
    `, departmentParams),
    queryCatalog(`
      SELECT jp.id AS "positionId", jp.name AS "positionName"
      FROM job_positions jp
      WHERE jp.company_id = $1 AND jp.deleted_at IS NULL ${positionSearch}
      ORDER BY jp.name
      LIMIT $2
    `, positionParams),
    queryCatalog(`
      SELECT wl.id AS "workLocationId", wl.name AS "workLocationName"
      FROM work_locations wl
      WHERE wl.company_id = $1 AND wl.deleted_at IS NULL ${workLocationSearch}
      ORDER BY wl.name
      LIMIT $2
    `, workLocationParams),
    queryCatalog(`
      SELECT wc.id AS "crewId", wc.name AS "crewName"
      FROM work_crews wc
      WHERE wc.company_id = $1 AND wc.deleted_at IS NULL ${crewSearch}
      ORDER BY wc.name
      LIMIT $2
    `, crewParams)
  ]);

  return { workers, areas, departments, positions, workLocations, crews };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows, columns = []) {
  if (!rows.length) return Buffer.from('', 'utf-8');
  const headers = columns.length > 0 ? columns.map((column) => column.key) : Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return Buffer.from(lines.join('\n'), 'utf-8');
}

async function rowsToCorporateXlsx({
  rows,
  columns,
  sheetName = 'Analitica',
  title,
  companyConfig = {},
  filters = {},
  summary = null,
  generatedAt = new Date()
}) {
  const workbook = new ExcelJS.Workbook();
  const companyName = getCompanyDisplayName(companyConfig);
  const primaryColor = hexToArgb(companyConfig.colorPrimario || companyConfig.color_primario, '#1E3A8A');
  const secondaryColor = hexToArgb(companyConfig.colorSecundario || companyConfig.color_secundario, '#3B82F6');
  const textColor = hexToArgb(companyConfig.colorTexto || companyConfig.color_texto, '#0F172A');
  const lightFill = 'FFF8FAFC';
  const borderColor = 'FFCBD5E1';

  workbook.creator = `${companyName} RR.HH.`;
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties = {
    title,
    subject: 'Analítica de asistencia',
    company: companyName
  };

  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  const safeColumns = columns.length > 0 ? columns : buildExportColumns(rows, 'aggregate');
  const colCount = Math.max(safeColumns.length, 6);
  const lastColumnLetter = sheet.getColumn(colCount).letter;

  sheet.mergeCells(`A1:${lastColumnLetter}1`);
  const titleRow = sheet.getRow(1);
  titleRow.height = 28;
  titleRow.getCell(1).value = String(title || 'Reporte corporativo').toUpperCase();
  titleRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryColor } };

  sheet.mergeCells(`A2:${lastColumnLetter}2`);
  const companyRow = sheet.getRow(2);
  companyRow.height = 22;
  companyRow.getCell(1).value = `${companyName}${companyConfig.ruc ? ` | RUC: ${companyConfig.ruc}` : ''}`;
  companyRow.getCell(1).font = { bold: true, color: { argb: textColor }, size: 11 };
  companyRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  companyRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

  sheet.mergeCells(`A3:${lastColumnLetter}3`);
  const metaRow = sheet.getRow(3);
  metaRow.getCell(1).value = `Generado: ${moment(generatedAt).tz(TIMEZONE).format('YYYY-MM-DD HH:mm')} | Filtros: ${JSON.stringify(compactObject(filters)) || '{}'}`;
  metaRow.getCell(1).font = { color: { argb: 'FF475569' }, size: 9 };
  metaRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

  const logoUrl = getCompanyLogoUrl(companyConfig);
  const logoBuffer = await loadAsset(logoUrl);
  if (logoBuffer) {
    try {
      const imageId = workbook.addImage({
        buffer: logoBuffer,
        extension: detectImageExtension(logoBuffer, logoUrl)
      });
      sheet.addImage(imageId, {
        tl: { col: 0.15, row: 0.15 },
        ext: { width: 90, height: 42 }
      });
    } catch (_) {
      // El archivo puede no ser un PNG/JPEG soportado por ExcelJS. El reporte sigue con encabezado corporativo.
    }
  }

  let currentRow = 5;
  if (summary && Object.keys(summary).length > 0) {
    const entries = Object.entries(summary);
    entries.forEach(([label, value], index) => {
      const col = index + 1;
      const cell = sheet.getCell(currentRow, col);
      cell.value = value;
      cell.font = { bold: true, color: { argb: primaryColor }, size: 12 };
      cell.alignment = { horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      cell.border = {
        top: { style: 'thin', color: { argb: borderColor } },
        left: { style: 'thin', color: { argb: borderColor } },
        bottom: { style: 'thin', color: { argb: borderColor } },
        right: { style: 'thin', color: { argb: borderColor } }
      };
      const labelCell = sheet.getCell(currentRow + 1, col);
      labelCell.value = label;
      labelCell.font = { color: { argb: 'FF475569' }, size: 9 };
      labelCell.alignment = { horizontal: 'center' };
    });
    currentRow += 3;
  }

  const headerRowNumber = currentRow;
  safeColumns.forEach((column, index) => {
    const cell = sheet.getCell(headerRowNumber, index + 1);
    cell.value = column.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryColor } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: secondaryColor } },
      left: { style: 'thin', color: { argb: secondaryColor } },
      bottom: { style: 'thin', color: { argb: secondaryColor } },
      right: { style: 'thin', color: { argb: secondaryColor } }
    };
    sheet.getColumn(index + 1).width = column.width || 18;
  });
  sheet.getRow(headerRowNumber).height = 24;

  if (rows.length > 0) {
    rows.forEach((row, rowIndex) => {
      const excelRow = sheet.getRow(headerRowNumber + rowIndex + 1);
      safeColumns.forEach((column, colIndex) => {
        const cell = excelRow.getCell(colIndex + 1);
        cell.value = row[column.key] === undefined || row[column.key] === null ? '' : row[column.key];
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = {
          bottom: { style: 'thin', color: { argb: borderColor } }
        };
        if (rowIndex % 2 === 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightFill } };
        }
      });
    });
  } else {
    sheet.getCell(headerRowNumber + 1, 1).value = 'Sin datos para el filtro seleccionado.';
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: safeColumns.length }
  };

  return workbook.xlsx.writeBuffer();
}

async function rowsToCorporatePdf({
  rows,
  columns,
  title,
  companyConfig = {},
  filters = {},
  summary = null,
  infoSections = []
}) {
  return generateCorporatePdf({
    companyConfig,
    reportTitle: title,
    documentType: 'Reporte corporativo RR.HH.',
    internalLabel: 'F-RRHH-ASIST-ANALYTICS',
    filters: compactObject(filters),
    infoSections,
    infoSectionsLayout: 'combined-two-column',
    columns: columns.map((column) => ({
      key: column.key,
      label: column.label,
      widthRatio: column.widthRatio
    })),
    rows,
    summary,
    showSummaryCards: Boolean(summary && Object.keys(summary).length > 0),
    signatureMode: 'flow',
    generatedBy: 'Sistema'
  });
}

function flattenKpis(kpis, section = 'KPIs') {
  return Object.entries(kpis).map(([metric, value]) => ({ section, metric: humanizeKey(metric), value }));
}

function flattenStatusDistribution(items) {
  return items.map((item) => ({
    section: 'statusDistribution',
    key: item.key,
    label: item.label,
    value: item.value,
    percentage: item.percentage
  }));
}

function flattenRanking(name, items) {
  return items.map((item) => ({
    section: name,
    rank: item.rank,
    workerId: item.workerId || item.areaId || item.workLocationId || item.crewId || null,
    label: item.label || item.fullName || item.workerName,
    value: item.value,
    secondaryValue: item.secondaryValue,
    attendanceRate: item.attendanceRate,
    punctualityRate: item.punctualityRate
  }));
}

function dashboardToExportRows(dashboard) {
  return [
    ...flattenKpis(dashboard.kpis),
    ...flattenStatusDistribution(dashboard.charts.statusDistribution),
    ...flattenRanking('topAbsentWorkers', dashboard.rankings.topAbsentWorkers),
    ...flattenRanking('topLateWorkers', dashboard.rankings.topLateWorkers),
    ...flattenRanking('bestAttendanceWorkers', dashboard.rankings.bestAttendanceWorkers)
  ];
}

function workerDetailToExportRows(detail) {
  return detail.calendar.map((day) => ({
    workerId: detail.worker.workerId,
    fullName: detail.worker.fullName,
    documentNumber: detail.worker.documentNumber,
    date: day.date,
    status: day.status,
    label: day.label,
    checkIn: day.checkIn,
    checkOut: day.checkOut,
    lateMinutes: day.lateMinutes,
    workedMinutes: day.workedMinutes,
    locationName: day.locationName,
    shiftName: day.shiftName
  }));
}

function aggregateDetailToExportRows(detail) {
  return [
    ...flattenKpis(detail.summary),
    ...flattenStatusDistribution(detail.statusDistribution),
    ...flattenRanking('topAbsentWorkers', detail.topAbsentWorkers),
    ...flattenRanking('topLateWorkers', detail.topLateWorkers),
    ...flattenRanking('bestAttendanceWorkers', detail.bestAttendanceWorkers)
  ];
}

async function buildExportBuffer(payload, format) {
  if (format === 'csv') {
    return { buffer: rowsToCsv(payload.rows, payload.columns), contentType: 'text/csv; charset=utf-8' };
  }
  if (format === 'xlsx') {
    return {
      buffer: await rowsToCorporateXlsx(payload),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }
  return { buffer: await rowsToCorporatePdf(payload), contentType: 'application/pdf' };
}

function normalizeExportFormat(value) {
  const format = String(value || 'xlsx').toLowerCase();
  if (!['csv', 'xlsx', 'pdf'].includes(format)) {
    throw createHttpError(400, 'INVALID_ANALYTICS_EXPORT_FORMAT', 'format debe ser csv, xlsx o pdf.', { format });
  }
  return format;
}

function normalizeExportScope(value) {
  const scope = String(value || 'dashboard');
  if (!['dashboard', 'table', 'worker', 'area', 'workLocation', 'crew'].includes(scope)) {
    throw createHttpError(400, 'INVALID_ANALYTICS_EXPORT_SCOPE', 'scope debe ser dashboard, table, worker, area, workLocation o crew.', { scope });
  }
  return scope;
}

function fileExtension(format) {
  return format === 'xlsx' ? 'xlsx' : format;
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

  async getTable(companyId, filters = {}) {
    const dataset = await this.getDataset(companyId, filters);
    return buildTableResponse(dataset, filters);
  }

  async getWorkerDetail(companyId, workerId, filters = {}) {
    validateUuid(workerId, 'workerId');
    const dataset = await this.getDataset(companyId, { ...filters, workerId });
    return buildWorkerDetailResponse(dataset, workerId);
  }

  async getAggregateDetail(companyId, type, entityId, filters = {}) {
    const config = entityConfig(type);
    if (!config) {
      throw createHttpError(400, 'INVALID_ANALYTICS_ENTITY', 'Tipo de entidad analítica inválido.', { type });
    }
    validateUuid(entityId, config.filterKey);
    const dataset = await this.getDataset(companyId, { ...filters, [config.filterKey]: entityId });
    return buildAggregateDetailResponse(dataset, type, entityId, parseLimit(filters.limit, 10));
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
    const summary = this.summarize(dataset);
    const { period: _period, filters: _filters, ...kpis } = summary;
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
      period: formatPeriodKey(dataset.period),
      dateRange: dataset.period,
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

  async getExportFilters(companyId, filters = {}) {
    const period = parsePeriod(filters);
    const statuses = normalizeStatuses(filters.status || filters.statuses);
    const catalogs = await getExportFilterCatalogs(companyId, filters);
    return {
      period: formatPeriodKey(period),
      dateRange: period,
      activeFilters: {
        ...publicFilters(filters, statuses),
        startDate: filters.startDate || filters.start_date || period.startDate,
        endDate: filters.endDate || filters.end_date || period.endDate,
        month: filters.month || period.month,
        status: filters.status || filters.statuses || null,
        search: filters.search || null,
        sortBy: filters.sortBy || filters.sort_by || null,
        sortDirection: filters.sortDirection || filters.sort_direction || null
      },
      acceptedFilters: [
        'month',
        'startDate',
        'endDate',
        'workerId',
        'departmentId',
        'areaId',
        'positionId',
        'workLocationId',
        'crewId',
        'status',
        'search',
        'sortBy',
        'sortDirection'
      ],
      formats: EXPORT_FORMAT_OPTIONS,
      scopes: EXPORT_SCOPE_OPTIONS,
      statuses: statusFilterOptions(),
      sortOptions: EXPORT_TABLE_SORT_OPTIONS,
      dimensions: catalogs,
      defaults: {
        format: 'xlsx',
        scope: 'dashboard',
        sortBy: 'fullName',
        sortDirection: 'asc'
      },
      generatedAt: new Date().toISOString()
    };
  }

  async exportAnalytics(companyId, filters = {}) {
    const format = normalizeExportFormat(filters.format);
    const scope = normalizeExportScope(filters.scope);
    const extension = fileExtension(format);
    const companyConfig = await getCompanyExportConfig(companyId);
    let rows = [];
    let title = 'Analítica de asistencia';
    let fileName;
    let exportScope = scope;
    let period = null;
    let summary = null;
    let infoEntity = null;
    let infoWorker = null;

    if (scope === 'dashboard') {
      const dashboard = await this.getDashboard(companyId, filters);
      rows = dashboardToExportRows(dashboard);
      title = `Analítica de asistencia ${dashboard.period}`;
      fileName = `attendance-analytics-${dashboard.period}.${extension}`;
      period = dashboard.dateRange;
      summary = dashboardSummaryCards(dashboard.kpis);
    } else if (scope === 'table') {
      const dataset = await this.getDataset(companyId, filters);
      rows = buildTableItems(workerSummaries(dataset.rows));
      rows = filterBySearch(rows, filters.search, [
        'fullName', 'documentNumber', 'areaName', 'positionName', 'departmentName', 'workLocationName', 'crewName'
      ]);
      rows = sortItems(rows, filters.sortBy || filters.sort_by || 'fullName', filters.sortDirection || filters.sort_direction || 'asc');
      title = `Tabla analítica de asistencia ${formatPeriodKey(dataset.period)}`;
      fileName = `attendance-analytics-table-${formatPeriodKey(dataset.period)}.${extension}`;
      period = dataset.period;
      summary = { Trabajadores: rows.length };
    } else if (scope === 'worker') {
      const workerId = validateUuid(filters.workerId || filters.worker_id, 'workerId');
      const detail = await this.getWorkerDetail(companyId, workerId, filters);
      rows = workerDetailToExportRows(detail);
      title = `Detalle de asistencia - ${detail.worker.fullName || workerId}`;
      fileName = `attendance-worker-${workerId}.${extension}`;
      exportScope = 'worker';
      period = detail.dateRange;
      summary = workerSummaryCards(detail.summary);
      infoWorker = detail.worker;
    } else {
      const idByScope = {
        area: filters.areaId || filters.area_id,
        workLocation: filters.workLocationId || filters.work_location_id,
        crew: filters.crewId || filters.crew_id
      };
      const entityId = validateUuid(idByScope[scope], `${scope}Id`);
      const detail = await this.getAggregateDetail(companyId, scope, entityId, filters);
      rows = aggregateDetailToExportRows(detail);
      title = `Detalle agregado de asistencia - ${detail.entity.name || entityId}`;
      fileName = `attendance-${scope}-${entityId}-${detail.period}.${extension}`;
      exportScope = 'aggregate';
      period = detail.dateRange;
      summary = aggregateSummaryCards(detail.summary);
      infoEntity = detail.entity;
    }

    const columns = buildExportColumns(rows, exportScope);
    const payload = {
      rows,
      columns,
      sheetName: scope === 'table' ? 'Tabla Analitica' : 'Analitica',
      title,
      companyConfig,
      filters: exportFilters(filters, period),
      summary,
      infoSections: buildInfoSections({
        scope,
        period: period ? formatPeriodKey(period) : filters.month || 'No especificado',
        rowCount: rows.length,
        entity: infoEntity,
        worker: infoWorker
      }),
      generatedAt: new Date()
    };
    const { buffer, contentType } = await buildExportBuffer(payload, format);
    return { buffer, contentType, fileName, format, scope, rowCount: rows.length };
  }

  async recalculate(companyId, filters = {}, actorUserId = null) {
    const dashboard = await this.getDashboard(companyId, filters);
    const affectedDays = moment.tz(dashboard.dateRange.endDate, 'YYYY-MM-DD', TIMEZONE)
      .diff(moment.tz(dashboard.dateRange.startDate, 'YYYY-MM-DD', TIMEZONE), 'days') + 1;
    const affectedWorkers = dashboard.kpis.totalWorkers || 0;
    const recalculatedAt = new Date().toISOString();
    let persisted = true;
    let recalculationId = null;

    const tableCheck = await query("SELECT to_regclass('public.attendance_analytics_recalculations') AS table_name");
    if (!tableCheck.rows[0]?.table_name) {
      persisted = false;
    }

    if (persisted) {
      const result = await query(`
        INSERT INTO attendance_analytics_recalculations (
          company_id, requested_by, start_date, end_date, filters, affected_workers, affected_days, recalculated_at
        )
        VALUES ($1, $2, $3::date, $4::date, $5::jsonb, $6, $7, $8::timestamptz)
        RETURNING id
      `, [
        companyId,
        actorUserId,
        dashboard.dateRange.startDate,
        dashboard.dateRange.endDate,
        JSON.stringify(filters || {}),
        affectedWorkers,
        affectedDays,
        recalculatedAt
      ]);
      recalculationId = result.rows[0]?.id || null;
    }

    return {
      message: persisted
        ? 'Analítica de asistencia recalculada y registrada.'
        : 'Analítica de asistencia recalculada en vivo; falta aplicar la migración de auditoría para persistir el registro.',
      data: dashboard,
      meta: {
        persisted,
        recalculationId,
        recalculatedAt,
        affectedWorkers,
        affectedDays
      }
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
module.exports.buildTableItems = buildTableItems;
module.exports.buildTableResponse = buildTableResponse;
module.exports.buildWorkerDetailResponse = buildWorkerDetailResponse;
module.exports.buildAggregateDetailResponse = buildAggregateDetailResponse;
module.exports.dashboardToExportRows = dashboardToExportRows;
module.exports.workerDetailToExportRows = workerDetailToExportRows;
module.exports.aggregateDetailToExportRows = aggregateDetailToExportRows;
