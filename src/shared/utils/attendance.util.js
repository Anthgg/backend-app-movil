const moment = require('moment-timezone');

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_NAME_TO_NUMBER = DAY_NAMES.reduce((acc, day, index) => {
  acc[day] = index + 1;
  return acc;
}, {});

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

function coerceWorkingDays(value) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return trimmed.split(',').map((day) => day.trim());
  }
}

function normalizeDay(value) {
  if (value === undefined || value === null || value === '') return null;

  const raw = String(value).trim().toLowerCase();
  const number = Number(raw);
  if (Number.isInteger(number) && number >= 1 && number <= 7) {
    return {
      number,
      name: DAY_NAMES[number - 1]
    };
  }

  const name = DAY_ALIASES[raw] || null;
  if (!name) return null;

  return {
    number: DAY_NAME_TO_NUMBER[name],
    name
  };
}

function normalizeWorkingDays(value, options = {}) {
  const fallback = options.fallback || [];
  const days = coerceWorkingDays(value);
  const source = Array.isArray(days) ? days : coerceWorkingDays(fallback);
  const normalized = (Array.isArray(source) ? source : [])
    .map(normalizeDay)
    .filter(Boolean);

  const seen = new Set();
  const unique = normalized.filter((day) => {
    if (seen.has(day.name)) return false;
    seen.add(day.name);
    return true;
  });

  return {
    numbers: unique.map((day) => day.number),
    names: unique.map((day) => day.name)
  };
}

function getShiftDayContext({ date, timezone, workingDays }) {
  const tz = timezone || 'America/Lima';
  const normalizedWorkingDays = normalizeWorkingDays(workingDays);

  // Safe date resolution
  let safeDate;
  if (date) {
    // Keep YYYY-MM-DD
    safeDate = String(date).slice(0, 10);
  } else {
    // Current date in timezone
    safeDate = moment().tz(tz).format('YYYY-MM-DD');
  }

  // Get the English weekday name explicitly to avoid locale issues.
  // Using moment-timezone for reliability.
  const targetDateMoment = moment.tz(`${safeDate} 12:00:00`, 'YYYY-MM-DD HH:mm:ss', tz);
  const day = targetDateMoment.locale('en').format('dddd').toLowerCase(); // e.g., 'monday', 'sunday'
  const dayOfWeek = DAY_NAME_TO_NUMBER[day] || null;

  const isWorkingDay = normalizedWorkingDays.names.length > 0
    ? normalizedWorkingDays.names.includes(day)
    : false;

  return {
    date: safeDate,
    day,
    dayName: day,
    dayOfWeek,
    timezone: tz,
    workingDays: normalizedWorkingDays.names,
    workingDaysNames: normalizedWorkingDays.names,
    workingDaysNumbers: normalizedWorkingDays.numbers,
    isWorkingDay
  };
}

function buildAttendanceError({ code, message, status = 422, details = {} }) {
  return {
    status,
    body: {
      success: false,
      code,
      error_code: code,
      errorCode: code,
      message,
      details,
      error: {
        code,
        details
      }
    }
  };
}

module.exports = {
  DAY_NAMES,
  DAY_NAME_TO_NUMBER,
  normalizeWorkingDays,
  getShiftDayContext,
  buildAttendanceError
};
