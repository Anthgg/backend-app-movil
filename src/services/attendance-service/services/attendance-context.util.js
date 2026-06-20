const moment = require('moment-timezone');
const { query } = require('../../../config/database');
const {
  normalizeWorkingDays: normalizeWorkingDaysContract,
  DAY_NAME_TO_NUMBER
} = require('../../../shared/utils/attendance.util');

const DEFAULT_TIMEZONE = process.env.TZ || 'America/Lima';
const DEFAULT_WORKING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED_ATTENDANCE_TIME_FORMATS = [
  'HH:mm:ss',
  'HH:mm',
  'ISO-8601 datetime',
  'DateTime string'
];
const ATTENDANCE_TIME_EXAMPLES = [
  '23:05:12',
  '23:05',
  '2026-06-15T23:05:12.000Z'
];

const DAY_ALIASES = {
  mon: 'monday',
  monday: 'monday',
  lunes: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  tuesday: 'tuesday',
  martes: 'tuesday',
  wed: 'wednesday',
  wednesday: 'wednesday',
  miercoles: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  thursday: 'thursday',
  jueves: 'thursday',
  fri: 'friday',
  friday: 'friday',
  viernes: 'friday',
  sat: 'saturday',
  saturday: 'saturday',
  sabado: 'saturday',
  sun: 'sunday',
  sunday: 'sunday',
  domingo: 'sunday'
};

function normalizeDetails(details) {
  if (!details || Array.isArray(details)) {
    return {};
  }
  return details;
}

function buildAttendanceError({
  code,
  message,
  status = 422,
  details = {}
}) {
  const normalizedDetails = normalizeDetails(details);

  return {
    status,
    body: {
      success: false,
      code,
      error_code: code,
      errorCode: code,
      message,
      details: normalizedDetails,
      error: {
        code,
        details: normalizedDetails
      }
    }
  };
}

function createAttendanceError({
  status = 422,
  code,
  message,
  details = {},
  extra = {}
}) {
  const normalizedDetails = normalizeDetails(details);
  const error = new Error(message);
  error.statusCode = status;
  error.errorCode = code;
  error.details = normalizedDetails;
  error.responseBody = buildAttendanceError({
    code,
    message,
    status,
    details: normalizedDetails
  }).body;
  Object.assign(error, extra);
  return error;
}

function isUuid(value) {
  return UUID_REGEX.test(String(value || '').trim());
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function asPlainBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

function parseObjectField(value) {
  if (!value || typeof value !== 'string') {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getBodyField(body, keys) {
  for (const key of keys) {
    if (firstPresent(body[key]) !== undefined) {
      return body[key];
    }
  }

  const lowerKeyMap = Object.keys(body).reduce((acc, key) => {
    acc[key.toLowerCase()] = key;
    return acc;
  }, {});

  for (const key of keys) {
    const actualKey = lowerKeyMap[key.toLowerCase()];
    if (actualKey && firstPresent(body[actualKey]) !== undefined) {
      return body[actualKey];
    }
  }

  return undefined;
}

function assignFirstPresent(body, targetKey, aliases) {
  if (firstPresent(body[targetKey]) !== undefined) {
    return;
  }

  const value = getBodyField(body, aliases);
  if (firstPresent(value) !== undefined) {
    body[targetKey] = value;
  }
}

function normalizeAttendanceRequestBody(req = {}) {
  const rawBody = asPlainBody(req.body);
  const payload = parseObjectField(getBodyField(rawBody, ['payload']));
  const body = { ...payload };
  for (const [key, value] of Object.entries(rawBody)) {
    if (firstPresent(value) !== undefined || body[key] === undefined) {
      body[key] = value;
    }
  }

  assignFirstPresent(body, 'attendanceTime', ['attendanceTime', 'attendance_time']);
  assignFirstPresent(body, 'attendance_time', ['attendance_time', 'attendanceTime']);
  assignFirstPresent(body, 'checkInTime', ['checkInTime', 'check_in_time']);
  assignFirstPresent(body, 'check_in_time', ['check_in_time', 'checkInTime']);
  assignFirstPresent(body, 'checkOutTime', ['checkOutTime', 'check_out_time', 'checkoutTime']);
  assignFirstPresent(body, 'check_out_time', ['check_out_time', 'checkOutTime', 'checkoutTime']);
  assignFirstPresent(body, 'timestamp', ['timestamp']);
  assignFirstPresent(body, 'clientTimestamp', ['clientTimestamp', 'client_timestamp']);
  assignFirstPresent(body, 'client_timestamp', ['client_timestamp', 'clientTimestamp']);
  assignFirstPresent(body, 'timezone', ['timezone', 'timeZone', 'tz']);
  assignFirstPresent(body, 'date', ['date', 'attendanceDate', 'attendance_date']);
  assignFirstPresent(body, 'attendanceDate', ['attendanceDate', 'attendance_date', 'date']);
  assignFirstPresent(body, 'attendance_date', ['attendance_date', 'attendanceDate', 'date']);
  assignFirstPresent(body, 'workLocationId', ['workLocationId', 'work_location_id']);
  assignFirstPresent(body, 'work_location_id', ['work_location_id', 'workLocationId']);

  req.body = body;
  return body;
}

function getRawWorkLocationId(req = {}) {
  return firstPresent(
    req.body?.workLocationId,
    req.body?.work_location_id,
    req.body?.workLocation?.id,
    req.query?.workLocationId,
    req.query?.work_location_id,
    req.query?.workLocation?.id
  ) || null;
}

function normalizeWorkLocationId(req = {}) {
  const raw = getRawWorkLocationId(req);
  if (!raw) return null;

  const workLocationId = String(raw).trim();
  if (!isUuid(workLocationId)) {
    throw createAttendanceError({
      status: 400,
      code: 'INVALID_WORK_LOCATION_ID',
      message: 'El identificador de obra enviado no es valido.',
      details: { workLocationId }
    });
  }

  return workLocationId;
}

function normalizeAttendanceDate(value = null, timezone = DEFAULT_TIMEZONE) {
  if (!value) {
    return moment().tz(timezone).format('YYYY-MM-DD');
  }

  if (value instanceof Date) {
    return moment(value).tz(timezone).format('YYYY-MM-DD');
  }

  const date = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !moment.tz(date, 'YYYY-MM-DD', true, timezone).isValid()) {
    throw createAttendanceError({
      status: 400,
      code: 'INVALID_ATTENDANCE_DATE',
      message: 'La fecha de asistencia debe tener formato YYYY-MM-DD.',
      details: { date: String(value) }
    });
  }

  return date;
}

function normalizeTimezone(timezone = DEFAULT_TIMEZONE) {
  const normalized = String(timezone || DEFAULT_TIMEZONE).trim();
  return moment.tz.zone(normalized) ? normalized : DEFAULT_TIMEZONE;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(String(value || '').trim());
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidTimeParts(hour, minute, second) {
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    Number.isInteger(second) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function createInvalidAttendanceTimeError({ field, value }) {
  const err = createAttendanceError({
    status: 400,
    code: 'INVALID_ATTENDANCE_TIME',
    message: 'La hora de asistencia no tiene un formato valido.',
    details: {
      providedValue: value,
      providedField: field,
      expectedFormat: 'HH:mm:ss',
      acceptedFormats: ['HH:mm:ss', 'HH:mm', 'ISO-8601 datetime', 'DateTime string'],
      examples: ['23:05:12', '23:05', '2026-06-15T23:05:12.000Z']
    }
  });
  throw err;
}

function getLocalDateTimeParts({ date = null, timezone = DEFAULT_TIMEZONE, now = new Date() } = {}) {
  const normalizedTimezone = normalizeTimezone(timezone);
  const localNow = moment(now).tz(normalizedTimezone);
  const localDate = date
    ? normalizeAttendanceDate(date, normalizedTimezone)
    : localNow.format('YYYY-MM-DD');

  return {
    date: localDate,
    time: localNow.format('HH:mm:ss'),
    timezone: normalizedTimezone
  };
}

function buildLocalTimestamp(date, time, timezone = DEFAULT_TIMEZONE) {
  const normalizedTimezone = normalizeTimezone(timezone);
  const normalizedDate = normalizeAttendanceDate(date, normalizedTimezone);
  const localMoment = moment.tz(
    `${normalizedDate} ${time}`,
    'YYYY-MM-DD HH:mm:ss',
    true,
    normalizedTimezone
  );

  return localMoment.isValid() ? localMoment.toISOString() : null;
}

function parseDateTimeValue(raw, timezone = DEFAULT_TIMEZONE) {
  const normalizedTimezone = normalizeTimezone(timezone);
  const isoMoment = moment(raw, moment.ISO_8601, true);
  if (isoMoment.isValid()) {
    return isoMoment.tz(normalizedTimezone);
  }

  const localMoment = moment.tz(raw, [
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DD HH:mm',
    'YYYY-MM-DD HH:mm:ssZ',
    'YYYY-MM-DD HH:mm:ss.SSSZ'
  ], true, normalizedTimezone);
  if (localMoment.isValid()) {
    return localMoment;
  }

  const parsedDate = new Date(raw);
  if (!Number.isNaN(parsedDate.getTime())) {
    return moment(parsedDate).tz(normalizedTimezone);
  }

  return null;
}

function normalizeAttendanceInput(rawValue, {
  fallbackDate = null,
  date = null,
  timezone = DEFAULT_TIMEZONE,
  now = new Date(),
  field = 'time'
} = {}) {
  const normalizedTimezone = normalizeTimezone(timezone);
  const explicitFallbackDate = fallbackDate || date;
  const normalizedFallbackDate = explicitFallbackDate
    ? normalizeAttendanceDate(explicitFallbackDate, normalizedTimezone)
    : null;
  const currentDateTime = getLocalDateTimeParts({ timezone: normalizedTimezone, now });

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    const normalizedDate = normalizedFallbackDate || currentDateTime.date;
    const normalizedTime = currentDateTime.time;
    return {
      date: normalizedDate,
      time: normalizedTime,
      timestamp: buildLocalTimestamp(normalizedDate, normalizedTime, normalizedTimezone),
      timezone: normalizedTimezone,
      sourceFormat: 'server_now'
    };
  }

  if (rawValue instanceof Date) {
    if (Number.isNaN(rawValue.getTime())) {
      createInvalidAttendanceTimeError({ field, value: String(rawValue) });
    }

    const local = moment(rawValue).tz(normalizedTimezone);
    const normalizedDate = normalizedFallbackDate || local.format('YYYY-MM-DD');
    const normalizedTime = local.format('HH:mm:ss');
    return {
      date: normalizedDate,
      time: normalizedTime,
      timestamp: normalizedFallbackDate
        ? buildLocalTimestamp(normalizedDate, normalizedTime, normalizedTimezone)
        : rawValue.toISOString(),
      timezone: normalizedTimezone,
      sourceFormat: 'date_object'
    };
  }

  let raw = String(rawValue).trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }

  let match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3]);
    if (!isValidTimeParts(hour, minute, second)) {
      createInvalidAttendanceTimeError({ field, value: raw });
    }

    const normalizedDate = normalizedFallbackDate || currentDateTime.date;
    const normalizedTime = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
    return {
      date: normalizedDate,
      time: normalizedTime,
      timestamp: buildLocalTimestamp(normalizedDate, normalizedTime, normalizedTimezone),
      timezone: normalizedTimezone,
      sourceFormat: 'HH:mm:ss'
    };
  }

  match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = 0;
    if (!isValidTimeParts(hour, minute, second)) {
      createInvalidAttendanceTimeError({ field, value: raw });
    }

    const normalizedDate = normalizedFallbackDate || currentDateTime.date;
    const normalizedTime = `${pad2(hour)}:${pad2(minute)}:00`;
    return {
      date: normalizedDate,
      time: normalizedTime,
      timestamp: buildLocalTimestamp(normalizedDate, normalizedTime, normalizedTimezone),
      timezone: normalizedTimezone,
      sourceFormat: 'HH:mm'
    };
  }

  const parsed = parseDateTimeValue(raw, normalizedTimezone);
  if (parsed?.isValid()) {
    const normalizedDate = normalizedFallbackDate || parsed.format('YYYY-MM-DD');
    const normalizedTime = parsed.format('HH:mm:ss');
    return {
      date: normalizedDate,
      time: normalizedTime,
      timestamp: normalizedFallbackDate
        ? buildLocalTimestamp(normalizedDate, normalizedTime, normalizedTimezone)
        : parsed.toISOString(),
      timezone: normalizedTimezone,
      sourceFormat: 'datetime'
    };
  }

  createInvalidAttendanceTimeError({ field, value: raw });
}

function normalizeAttendanceTime(value, {
  date = null,
  timezone = DEFAULT_TIMEZONE,
  field = 'time'
} = {}) {
  return normalizeAttendanceInput(value, {
    fallbackDate: date,
    timezone,
    field
  }).time;
}

function buildAttendanceMoment({ date, time, timezone = DEFAULT_TIMEZONE }) {
  const normalizedTimezone = normalizeTimezone(timezone);
  const normalizedDate = normalizeAttendanceDate(date, normalizedTimezone);
  const normalizedTime = normalizeAttendanceTime(time, {
    date: normalizedDate,
    timezone: normalizedTimezone
  });

  return moment.tz(`${normalizedDate} ${normalizedTime}`, 'YYYY-MM-DD HH:mm:ss', normalizedTimezone);
}

function normalizeWorkingDays(value, fallback = DEFAULT_WORKING_DAYS) {
  const normalized = normalizeWorkingDaysContract(value, { fallback });
  return normalized.names.length > 0 ? normalized.names : fallback;
}

function normalizeWorkingDayNumbers(value, fallback = DEFAULT_WORKING_DAYS) {
  const normalized = normalizeWorkingDaysContract(value, { fallback });
  return normalized.numbers;
}

function getShiftTimezone(shift = null, policy = null) {
  const timezone = String(
    shift?.timezone ||
    shift?.time_zone ||
    policy?.timezone ||
    DEFAULT_TIMEZONE
  ).trim();

  return moment.tz.zone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

function getShiftWorkingDays(shift = null, policy = null) {
  const shiftDays = shift?.workingDaysNames || shift?.working_days || shift?.workingDays;
  if (Array.isArray(shiftDays) || typeof shiftDays === 'string') {
    return normalizeWorkingDays(shiftDays, DEFAULT_WORKING_DAYS);
  }

  return normalizeWorkingDays(policy?.workingDaysNames || policy?.working_days || policy?.workingDays, DEFAULT_WORKING_DAYS);
}

function getAttendanceDayContext({ date = null, shift = null, policy = null } = {}) {
  const timezone = getShiftTimezone(shift, policy);
  const normalizedDate = normalizeAttendanceDate(date, timezone);
  const day = moment.tz(normalizedDate, 'YYYY-MM-DD', timezone).format('dddd').toLowerCase();
  const workingDays = getShiftWorkingDays(shift, policy);
  const workingDaysNumbers = normalizeWorkingDayNumbers(workingDays, DEFAULT_WORKING_DAYS);

  return {
    date: normalizedDate,
    day,
    dayName: day,
    dayOfWeek: DAY_NAME_TO_NUMBER[day] || null,
    timezone,
    workingDays,
    workingDaysNames: workingDays,
    workingDaysNumbers,
    isWorkingDay: Boolean(shift) && (shift.workerIsWorkingDay !== undefined ? shift.workerIsWorkingDay : (workingDays.includes(day) && !(shift.isHoliday))),
    shiftId: shift?.id || null,
    shiftName: shift?.name || null,
    isHoliday: shift?.isHoliday || false,
    holiday: shift?.holiday || null,
    isRestDay: shift?.isRestDay || false,
    restDayType: shift?.restDayType || null
  };
}

function buildNonWorkingDayDetails(schedule, date = null) {
  const dayContext = getAttendanceDayContext({
    date: date || schedule?.date,
    shift: schedule?.shift,
    policy: schedule?.policy
  });

  return {
    date: dayContext.date,
    day: dayContext.day,
    dayOfWeek: dayContext.dayOfWeek,
    timezone: dayContext.timezone,
    workingDays: dayContext.workingDays,
    workingDaysNames: dayContext.workingDaysNames,
    workingDaysNumbers: dayContext.workingDaysNumbers,
    shiftId: dayContext.shiftId,
    shiftName: dayContext.shiftName
  };
}

function assertScheduleAllowsAttendance(schedule, date = null) {
  if (!schedule?.shift) {
    throw createAttendanceError({
      status: 422,
      code: 'SHIFT_NOT_ASSIGNED',
      message: 'El trabajador no tiene un turno asignado para esta fecha.',
      details: {
        date: normalizeAttendanceDate(date || schedule?.date, schedule?.policy?.timezone || DEFAULT_TIMEZONE)
      }
    });
  }

  const dayContext = getAttendanceDayContext({
    date: date || schedule.date,
    shift: schedule.shift,
    policy: schedule.policy
  });

  if (!dayContext.isWorkingDay) {
    throw createAttendanceError({
      status: 422,
      code: 'NON_WORKING_DAY',
      message: 'La fecha indicada no esta configurada como dia laboral para este turno.',
      details: buildNonWorkingDayDetails(schedule, dayContext.date)
    });
  }

  return dayContext;
}

async function resolveAuthenticatedWorker(req) {
  const userId = req.user?.id;
  const companyId = req.tenantId || req.user?.companyId || req.user?.company_id || null;

  if (!userId || !companyId) {
    throw createAttendanceError({
      status: 401,
      code: 'AUTH_CONTEXT_MISSING',
      message: 'No se pudo resolver el usuario autenticado para asistencia.',
      details: { hasUserId: Boolean(userId), hasCompanyId: Boolean(companyId) }
    });
  }

  const result = await query(
    `SELECT u.id AS user_id,
            u.company_id AS user_company_id,
            u.is_active AS user_active,
            u.status AS user_status,
            w.id AS worker_id,
            w.company_id AS worker_company_id,
            w.is_active AS worker_active,
            w.employment_status,
            w.work_location_id AS base_work_location_id,
            cw.crew_id
     FROM users u
     LEFT JOIN workers w
       ON w.user_id = u.id
      AND w.deleted_at IS NULL
     LEFT JOIN crew_workers cw
       ON cw.worker_id = w.id
      AND cw.company_id = w.company_id
      AND cw.is_active = TRUE
      AND cw.unassigned_at IS NULL
     WHERE u.id = $1
       AND u.deleted_at IS NULL
     ORDER BY CASE WHEN w.company_id = $2 THEN 0 ELSE 1 END,
              w.created_at DESC NULLS LAST
     LIMIT 1`,
    [userId, companyId]
  );

  const row = result.rows[0];
  if (!row) {
    throw createAttendanceError({
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'El usuario autenticado no existe o no esta activo.',
      details: { userId }
    });
  }

  if (!row.user_active || row.user_status !== 'active') {
    throw createAttendanceError({
      status: 403,
      code: 'USER_DISABLED',
      message: 'El usuario autenticado no esta activo.',
      details: { userId, userStatus: row.user_status || null }
    });
  }

  if (row.user_company_id !== companyId) {
    throw createAttendanceError({
      status: 403,
      code: 'WORKER_COMPANY_MISMATCH',
      message: 'El trabajador no pertenece a la empresa del usuario autenticado.',
      details: {
        userId,
        companyId,
        userCompanyId: row.user_company_id || null
      }
    });
  }

  if (!row.worker_id) {
    throw createAttendanceError({
      status: 404,
      code: 'WORKER_NOT_FOUND',
      message: 'El usuario autenticado no tiene trabajador asociado.',
      details: { userId, companyId }
    });
  }

  if (row.worker_company_id !== companyId) {
    throw createAttendanceError({
      status: 403,
      code: 'WORKER_COMPANY_MISMATCH',
      message: 'El trabajador no pertenece a la empresa del usuario autenticado.',
      details: {
        workerId: row.worker_id,
        companyId,
        workerCompanyId: row.worker_company_id || null
      }
    });
  }

  if (!row.worker_active || row.employment_status !== 'active') {
    throw createAttendanceError({
      status: 422,
      code: 'WORKER_NOT_ACTIVE',
      message: 'El trabajador autenticado no esta activo.',
      details: {
        workerId: row.worker_id,
        workerStatus: row.employment_status || null,
        isActive: row.worker_active === true
      }
    });
  }

  return {
    userId,
    companyId,
    workerId: row.worker_id,
    workerStatus: row.employment_status || null,
    crewId: row.crew_id || null,
    baseWorkLocationId: row.base_work_location_id || null
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_WORKING_DAYS,
  buildAttendanceError,
  createAttendanceError,
  isUuid,
  isValidTime,
  getLocalDateTimeParts,
  normalizeAttendanceInput,
  normalizeAttendanceTime,
  normalizeAttendanceRequestBody,
  buildAttendanceMoment,
  normalizeWorkLocationId,
  normalizeAttendanceDate,
  normalizeWorkingDays,
  getShiftTimezone,
  getShiftWorkingDays,
  getAttendanceDayContext,
  buildNonWorkingDayDetails,
  assertScheduleAllowsAttendance,
  resolveAuthenticatedWorker
};
