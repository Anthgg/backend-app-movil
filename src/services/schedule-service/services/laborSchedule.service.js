const moment = require('moment-timezone');
const { query, withTransaction } = require('../../../config/database');
const { logAudit } = require('../../../shared/utils/audit');
const {
  normalizeWorkingDays: normalizeWorkingDaysContract,
  DAY_NAME_TO_NUMBER
} = require('../../../shared/utils/attendance.util');

const DEFAULT_TIMEZONE = process.env.TZ || 'America/Lima';
const DEFAULT_WORKING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TIME_ONLY_REGEX = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

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
  miércoles: 'wednesday',
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
  sábado: 'saturday',
  sun: 'sunday',
  sunday: 'sunday',
  domingo: 'sunday'
};

function createHttpError(statusCode, errorCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (Object.keys(details).length > 0) {
    error.details = details;
  }
  return error;
}

function normalizeDate(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) {
    return moment().tz(timezone).format('YYYY-MM-DD');
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return moment(value).tz(timezone).format('YYYY-MM-DD');
}

function normalizeTime(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) {
      throw createHttpError(400, 'INVALID_TIME', 'La hora debe tener formato HH:mm.');
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw createHttpError(400, 'INVALID_TIME', 'La hora debe estar entre 00:00 y 23:59.');
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  return moment(value).format('HH:mm');
}

function toInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes', 'si', 'sí'].includes(String(value).toLowerCase());
}

function hasOwn(data, key) {
  return Object.prototype.hasOwnProperty.call(data || {}, key);
}

function firstProvided(data, keys) {
  for (const key of keys) {
    if (hasOwn(data, key)) {
      return data[key];
    }
  }
  return undefined;
}

function parseWorkingDays(value, fallback = DEFAULT_WORKING_DAYS) {
  const normalized = normalizeWorkingDaysContract(value, { fallback });
  if (normalized.names.length > 0) {
    return normalized.names;
  }

  return normalizeWorkingDaysContract(fallback, { fallback: DEFAULT_WORKING_DAYS }).names;
}

function normalizeWorkingDays(value, fallback = DEFAULT_WORKING_DAYS) {
  const normalized = normalizeWorkingDaysContract(value, { fallback });
  if (normalized.names.length > 0) {
    return normalized;
  }

  return normalizeWorkingDaysContract(fallback, { fallback: DEFAULT_WORKING_DAYS });
}

function getDayName(dateValue, timezone = DEFAULT_TIMEZONE) {
  return moment.tz(normalizeDate(dateValue, timezone), 'YYYY-MM-DD', timezone).format('dddd').toLowerCase();
}

function getDayOfWeek(dateValue, timezone = DEFAULT_TIMEZONE) {
  return DAY_NAME_TO_NUMBER[getDayName(dateValue, timezone)] || null;
}

function timeToMinutes(time) {
  const normalized = normalizeTime(time);
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours * 60 + minutes;
}

function calculatePresenceMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);

  if (end <= start) {
    end += 24 * 60;
  }

  return end - start;
}

function calculateEffectiveMinutes(startTime, endTime, breakMinutes = 0, breakPaid = false) {
  const presenceMinutes = calculatePresenceMinutes(startTime, endTime);
  if (breakPaid) {
    return presenceMinutes;
  }

  return Math.max(presenceMinutes - Math.max(toInteger(breakMinutes, 0), 0), 0);
}

function buildShiftMoments(dateValue, shift, timezone = DEFAULT_TIMEZONE) {
  if (!shift?.startTime || !shift?.endTime) {
    return null;
  }

  const date = normalizeDate(dateValue, timezone);
  const scheduledCheckIn = moment.tz(`${date} ${shift.startTime}`, 'YYYY-MM-DD HH:mm', timezone);
  const scheduledCheckOut = moment.tz(`${date} ${shift.endTime}`, 'YYYY-MM-DD HH:mm', timezone);

  if (scheduledCheckOut.isSameOrBefore(scheduledCheckIn)) {
    scheduledCheckOut.add(1, 'day');
  }

  return { scheduledCheckIn, scheduledCheckOut };
}

function parseAttendanceMoment(value, dateValue, timezone = DEFAULT_TIMEZONE) {
  if (!value) {
    return null;
  }

  if (moment.isMoment(value)) {
    return value.clone().tz(timezone);
  }

  if (value instanceof Date) {
    return moment(value).tz(timezone);
  }

  const raw = String(value).trim();
  if (TIME_ONLY_REGEX.test(raw)) {
    const date = normalizeDate(dateValue, timezone);
    const time = raw.length === 5 ? `${raw}:00` : raw;
    return moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm:ss', timezone);
  }

  return moment(raw, [
    moment.ISO_8601,
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DD HH:mm:ssZ',
    'YYYY-MM-DD HH:mm:ss.SSSZ'
  ], true).tz(timezone);
}

function serializeTime(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 5);
  }

  return moment(value).format('HH:mm');
}

function mapPolicy(row) {
  if (!row) {
    return null;
  }

  const normalizedWorkingDays = normalizeWorkingDays(row.working_days, DEFAULT_WORKING_DAYS);
  const workingDayNames = normalizedWorkingDays.names;
  const workingDayNumbers = normalizedWorkingDays.numbers;

  return {
    id: row.id,
    companyId: row.company_id,
    lateToleranceMinutes: Number(row.late_tolerance_minutes ?? 5),
    late_tolerance_minutes: Number(row.late_tolerance_minutes ?? 5),
    autoAbsenceEnabled: row.auto_absence_enabled !== false,
    auto_absence_enabled: row.auto_absence_enabled !== false,
    autoAbsenceAfterTime: serializeTime(row.auto_absence_after_time) || '23:59',
    auto_absence_after_time: serializeTime(row.auto_absence_after_time) || '23:59',
    defaultShiftKind: row.default_shift_kind || 'with_break',
    default_shift_kind: row.default_shift_kind || 'with_break',
    defaultEffectiveMinutes: Number(row.default_effective_minutes ?? 480),
    default_effective_minutes: Number(row.default_effective_minutes ?? 480),
    defaultBreakMinutes: Number(row.default_break_minutes ?? 60),
    default_break_minutes: Number(row.default_break_minutes ?? 60),
    defaultBreakPaid: row.default_break_paid === true,
    default_break_paid: row.default_break_paid === true,
    weeklyTargetMinutes: Number(row.weekly_target_minutes ?? 2880),
    weekly_target_minutes: Number(row.weekly_target_minutes ?? 2880),
    workingDays: workingDayNumbers,
    workingDaysNames: workingDayNames,
    working_days: workingDayNames,
    working_days_numbers: workingDayNumbers,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializePolicy(policy) {
  if (!policy) return null;

  return {
    id: policy.id,
    companyId: policy.companyId,
    lateToleranceMinutes: policy.lateToleranceMinutes,
    autoAbsenceEnabled: policy.autoAbsenceEnabled,
    autoAbsenceAfterTime: policy.autoAbsenceAfterTime,
    defaultShiftKind: policy.defaultShiftKind,
    defaultEffectiveMinutes: policy.defaultEffectiveMinutes,
    defaultBreakMinutes: policy.defaultBreakMinutes,
    defaultBreakPaid: policy.defaultBreakPaid,
    weeklyTargetMinutes: policy.weeklyTargetMinutes,
    workingDays: policy.workingDays,
    workingDaysNames: policy.workingDaysNames,
    timezone: policy.timezone,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt
  };
}

function mapShift(row, policy = null) {
  if (!row?.id) {
    return null;
  }

  const startTime = serializeTime(row.start_time || row.startTime);
  const endTime = serializeTime(row.end_time || row.endTime);
  const breakMinutes = Number(row.break_minutes ?? row.breakMinutes ?? 0);
  const breakPaid = row.break_paid === true || row.breakPaid === true;
  const effectiveMinutes = Number(
    row.effective_minutes ??
    row.effectiveMinutes ??
    (startTime && endTime ? calculateEffectiveMinutes(startTime, endTime, breakMinutes, breakPaid) : policy?.defaultEffectiveMinutes ?? 480)
  );
  const weeklyTargetMinutes = Number(row.weekly_target_minutes ?? row.weeklyTargetMinutes ?? policy?.weeklyTargetMinutes ?? 2880);
  const toleranceMinutes = Number(row.tolerance_minutes ?? row.toleranceMinutes ?? policy?.lateToleranceMinutes ?? 5);
  const policyFallbackDays = policy?.workingDaysNames || policy?.working_days || DEFAULT_WORKING_DAYS;
  const normalizedWorkingDays = row.working_days
    ? normalizeWorkingDays(row.working_days, policyFallbackDays)
    : normalizeWorkingDays(policyFallbackDays, DEFAULT_WORKING_DAYS);
  const workingDayNames = normalizedWorkingDays.names;
  const workingDayNumbers = normalizedWorkingDays.numbers;

  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name || 'Turno asignado',
    startTime,
    endTime,
    start_time: startTime,
    end_time: endTime,
    toleranceMinutes,
    tolerance_minutes: toleranceMinutes,
    effectiveMinutes,
    effective_minutes: effectiveMinutes,
    breakMinutes,
    break_minutes: breakMinutes,
    breakPaid,
    break_paid: breakPaid,
    weeklyTargetMinutes,
    weekly_target_minutes: weeklyTargetMinutes,
    allowsOvertime: row.allows_overtime !== false,
    allows_overtime: row.allows_overtime !== false,
    isActive: row.is_active !== false && row.status !== 'inactive',
    is_active: row.is_active !== false && row.status !== 'inactive',
    status: row.status || (row.is_active === false ? 'inactive' : 'active'),
    timezone: row.timezone || policy?.timezone || DEFAULT_TIMEZONE,
    workingDays: workingDayNumbers,
    workingDaysNames: workingDayNames,
    working_days: workingDayNames,
    working_days_numbers: workingDayNumbers,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getDb(client) {
  return client || { query };
}

async function ensurePolicy(companyId, client = null) {
  const db = getDb(client);
  await db.query(
    `INSERT INTO company_labor_policies (company_id)
     VALUES ($1)
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId]
  );

  const result = await db.query(
    `SELECT *
     FROM company_labor_policies
     WHERE company_id = $1`,
    [companyId]
  );

  return mapPolicy(result.rows[0]);
}

async function getPolicy(companyId) {
  return ensurePolicy(companyId);
}

function buildPolicyPayload(data = {}, userId = null) {
  const payload = {};

  if (data.late_tolerance_minutes !== undefined || data.lateToleranceMinutes !== undefined) {
    payload.late_tolerance_minutes = Math.max(toInteger(data.lateToleranceMinutes ?? data.late_tolerance_minutes, 5), 0);
  }
  if (data.auto_absence_enabled !== undefined || data.autoAbsenceEnabled !== undefined) {
    payload.auto_absence_enabled = toBoolean(data.autoAbsenceEnabled ?? data.auto_absence_enabled, true);
  }
  if (data.auto_absence_after_time !== undefined || data.autoAbsenceAfterTime !== undefined) {
    payload.auto_absence_after_time = normalizeTime(data.autoAbsenceAfterTime ?? data.auto_absence_after_time);
  }
  if (data.default_shift_kind !== undefined || data.defaultShiftKind !== undefined) {
    payload.default_shift_kind = String(data.defaultShiftKind ?? data.default_shift_kind).trim() || 'with_break';
  }
  if (data.default_effective_minutes !== undefined || data.defaultEffectiveMinutes !== undefined) {
    payload.default_effective_minutes = Math.max(toInteger(data.defaultEffectiveMinutes ?? data.default_effective_minutes, 480), 1);
  }
  if (data.default_break_minutes !== undefined || data.defaultBreakMinutes !== undefined) {
    payload.default_break_minutes = Math.max(toInteger(data.defaultBreakMinutes ?? data.default_break_minutes, 0), 0);
  }
  if (data.default_break_paid !== undefined || data.defaultBreakPaid !== undefined) {
    payload.default_break_paid = toBoolean(data.defaultBreakPaid ?? data.default_break_paid, false);
  }
  if (data.weekly_target_minutes !== undefined || data.weeklyTargetMinutes !== undefined || data.weekly_target_hours !== undefined || data.weeklyTargetHours !== undefined) {
    const minutes = data.weeklyTargetMinutes ?? data.weekly_target_minutes;
    const hours = data.weeklyTargetHours ?? data.weekly_target_hours;
    payload.weekly_target_minutes = minutes !== undefined ? Math.max(toInteger(minutes, 2880), 1) : Math.max(toInteger(Number(hours) * 60, 2880), 1);
  }
  if (data.working_days !== undefined || data.workingDays !== undefined) {
    payload.working_days = JSON.stringify(normalizeWorkingDays(data.workingDays ?? data.working_days).numbers);
  }
  if (data.timezone !== undefined) {
    const timezone = String(data.timezone || '').trim() || DEFAULT_TIMEZONE;
    if (!moment.tz.zone(timezone)) {
      throw createHttpError(400, 'INVALID_TIMEZONE', 'La zona horaria no es valida.');
    }
    payload.timezone = timezone;
  }

  if (userId) {
    payload.updated_by = userId;
  }

  return payload;
}

async function updatePolicy(companyId, data, userId, req = null) {
  return withTransaction(async (client) => {
    const previous = await ensurePolicy(companyId, client);
    const payload = buildPolicyPayload(data, userId);

    if (Object.keys(payload).length === 0) {
      return previous;
    }

    const entries = Object.entries(payload);
    const setSql = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ');
    const params = [companyId, ...entries.map(([, value]) => value)];
    const result = await client.query(
      `UPDATE company_labor_policies
       SET ${setSql}, updated_at = NOW()
       WHERE company_id = $1
       RETURNING *`,
      params
    );
    const updated = mapPolicy(result.rows[0]);

    await logAudit({
      userId,
      companyId,
      module: 'SCHEDULE',
      action: 'UPDATE_LABOR_POLICY',
      entity: 'company_labor_policies',
      entityId: updated.id,
      oldData: previous,
      newData: updated,
      req: req || {}
    });

    return updated;
  });
}

function buildShiftPayload(data = {}, policy, userId = null, { isCreate = false } = {}) {
  const payload = {};

  if (isCreate || data.name !== undefined) {
    const name = String(data.name || '').trim();
    if (!name) {
      throw createHttpError(400, 'SHIFT_NAME_REQUIRED', 'El nombre del turno es obligatorio.');
    }
    payload.name = name;
  }

  if (isCreate || data.start_time !== undefined || data.startTime !== undefined) {
    payload.start_time = normalizeTime(data.startTime ?? data.start_time);
  }

  if (isCreate || data.end_time !== undefined || data.endTime !== undefined) {
    payload.end_time = normalizeTime(data.endTime ?? data.end_time);
  }

  if (data.tolerance_minutes !== undefined || data.toleranceMinutes !== undefined || isCreate) {
    payload.tolerance_minutes = Math.max(toInteger(data.toleranceMinutes ?? data.tolerance_minutes, policy?.lateToleranceMinutes ?? 5), 0);
  }

  if (data.break_minutes !== undefined || data.breakMinutes !== undefined || isCreate) {
    payload.break_minutes = Math.max(toInteger(data.breakMinutes ?? data.break_minutes, policy?.defaultBreakMinutes ?? 0), 0);
  }

  if (data.break_paid !== undefined || data.breakPaid !== undefined || isCreate) {
    payload.break_paid = toBoolean(data.breakPaid ?? data.break_paid, policy?.defaultBreakPaid ?? false);
  }

  if (data.weekly_target_minutes !== undefined || data.weeklyTargetMinutes !== undefined || data.weekly_target_hours !== undefined || data.weeklyTargetHours !== undefined || isCreate) {
    const minutes = data.weeklyTargetMinutes ?? data.weekly_target_minutes;
    const hours = data.weeklyTargetHours ?? data.weekly_target_hours;
    if (minutes !== undefined) {
      payload.weekly_target_minutes = Math.max(toInteger(minutes, policy?.weeklyTargetMinutes ?? 2880), 1);
    } else if (hours !== undefined) {
      payload.weekly_target_minutes = Math.max(toInteger(Number(hours) * 60, policy?.weeklyTargetMinutes ?? 2880), 1);
    } else {
      payload.weekly_target_minutes = policy?.weeklyTargetMinutes ?? 2880;
    }
  }

  if (data.allows_overtime !== undefined || data.allowsOvertime !== undefined || isCreate) {
    payload.allows_overtime = toBoolean(data.allowsOvertime ?? data.allows_overtime, true);
  }

  if (data.is_active !== undefined || data.isActive !== undefined) {
    payload.is_active = toBoolean(data.isActive ?? data.is_active, true);
    payload.status = payload.is_active ? 'active' : 'inactive';
  } else if (isCreate) {
    payload.is_active = true;
    payload.status = 'active';
  }

  if (data.status !== undefined) {
    payload.status = String(data.status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
    payload.is_active = payload.status === 'active';
  }

  if (data.timezone !== undefined || isCreate) {
    const timezone = String(data.timezone || policy?.timezone || DEFAULT_TIMEZONE).trim();
    if (!moment.tz.zone(timezone)) {
      throw createHttpError(400, 'INVALID_TIMEZONE', 'La zona horaria no es valida.');
    }
    payload.timezone = timezone;
  }

  if (data.working_days !== undefined || data.workingDays !== undefined) {
    payload.working_days = JSON.stringify(normalizeWorkingDays(
      data.workingDays ?? data.working_days,
      policy?.workingDaysNames || policy?.working_days || DEFAULT_WORKING_DAYS
    ).numbers);
  }

  if (payload.start_time && payload.end_time) {
    const breakMinutes = payload.break_minutes ?? policy?.defaultBreakMinutes ?? 0;
    const breakPaid = payload.break_paid ?? policy?.defaultBreakPaid ?? false;
    payload.effective_minutes = data.effective_minutes !== undefined || data.effectiveMinutes !== undefined
      ? Math.max(toInteger(data.effectiveMinutes ?? data.effective_minutes, policy?.defaultEffectiveMinutes ?? 480), 1)
      : calculateEffectiveMinutes(payload.start_time, payload.end_time, breakMinutes, breakPaid);
  } else if (data.effective_minutes !== undefined || data.effectiveMinutes !== undefined) {
    payload.effective_minutes = Math.max(toInteger(data.effectiveMinutes ?? data.effective_minutes, policy?.defaultEffectiveMinutes ?? 480), 1);
  }

  if (userId) {
    if (isCreate) {
      payload.created_by = userId;
    }
    payload.updated_by = userId;
  }

  return payload;
}

async function listShifts(companyId, filters = {}) {
  const includeInactive = toBoolean(filters.include_inactive ?? filters.includeInactive, false);
  const policy = await ensurePolicy(companyId);
  const params = [companyId];
  const where = ['company_id = $1', 'deleted_at IS NULL'];

  if (!includeInactive) {
    where.push("COALESCE(is_active, true) = true");
    where.push("COALESCE(status, 'active') <> 'inactive'");
  }

  const result = await query(
    `SELECT *
     FROM shifts
     WHERE ${where.join(' AND ')}
     ORDER BY start_time ASC, name ASC`,
    params
  );

  return result.rows.map((row) => mapShift(row, policy));
}

async function getShift(companyId, shiftId, { includeInactive = false } = {}) {
  const policy = await ensurePolicy(companyId);
  const result = await query(
    `SELECT *
     FROM shifts
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL
       AND ($3::boolean = true OR (COALESCE(is_active, true) = true AND COALESCE(status, 'active') <> 'inactive'))
     LIMIT 1`,
    [shiftId, companyId, includeInactive]
  );

  return mapShift(result.rows[0], policy);
}

async function createShift(companyId, data, userId, req = null) {
  return withTransaction(async (client) => {
    const policy = await ensurePolicy(companyId, client);
    const payload = buildShiftPayload(data, policy, userId, { isCreate: true });
    const columns = Object.keys({ company_id: companyId, ...payload });
    const params = Object.values({ company_id: companyId, ...payload });
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const result = await client.query(
      `INSERT INTO shifts (${columns.join(', ')})
       VALUES (${placeholders})
       RETURNING *`,
      params
    );
    const shift = mapShift(result.rows[0], policy);

    await logAudit({
      userId,
      companyId,
      module: 'SCHEDULE',
      action: 'CREATE_SHIFT',
      entity: 'shifts',
      entityId: shift.id,
      newData: shift,
      req: req || {}
    });

    return shift;
  });
}

async function updateShift(companyId, shiftId, data, userId, req = null) {
  return withTransaction(async (client) => {
    const previousResult = await client.query(
      `SELECT *
       FROM shifts
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL`,
      [shiftId, companyId]
    );
    const previousRow = previousResult.rows[0];
    if (!previousRow) {
      throw createHttpError(404, 'SHIFT_NOT_FOUND', 'Turno no encontrado.');
    }

    const policy = await ensurePolicy(companyId, client);
    const merged = { ...previousRow, ...data };
    const shouldRecalculateEffectiveMinutes =
      data.effective_minutes === undefined &&
      data.effectiveMinutes === undefined &&
      (
        data.start_time !== undefined ||
        data.startTime !== undefined ||
        data.end_time !== undefined ||
        data.endTime !== undefined ||
        data.break_minutes !== undefined ||
        data.breakMinutes !== undefined ||
        data.break_paid !== undefined ||
        data.breakPaid !== undefined
      );
    if (shouldRecalculateEffectiveMinutes) {
      delete merged.effective_minutes;
      delete merged.effectiveMinutes;
    }
    const payload = buildShiftPayload(merged, policy, userId, { isCreate: false });

    if (Object.keys(payload).length === 0) {
      return mapShift(previousRow, policy);
    }

    const entries = Object.entries(payload);
    const setSql = entries.map(([key], index) => `${key} = $${index + 3}`).join(', ');
    const result = await client.query(
      `UPDATE shifts
       SET ${setSql}, updated_at = NOW()
       WHERE id = $1
         AND company_id = $2
       RETURNING *`,
      [shiftId, companyId, ...entries.map(([, value]) => value)]
    );
    const updated = mapShift(result.rows[0], policy);

    await logAudit({
      userId,
      companyId,
      module: 'SCHEDULE',
      action: 'UPDATE_SHIFT',
      entity: 'shifts',
      entityId: shiftId,
      oldData: mapShift(previousRow, policy),
      newData: updated,
      req: req || {}
    });

    return updated;
  });
}

async function deleteShift(companyId, shiftId, userId, req = null) {
  return withTransaction(async (client) => {
    const previousResult = await client.query(
      `SELECT *
       FROM shifts
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL`,
      [shiftId, companyId]
    );
    const previous = previousResult.rows[0];
    if (!previous) {
      throw createHttpError(404, 'SHIFT_NOT_FOUND', 'Turno no encontrado.');
    }

    await client.query(
      `UPDATE shifts
       SET is_active = false,
           status = 'inactive',
           deleted_at = NOW(),
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $1
         AND company_id = $2`,
      [shiftId, companyId, userId]
    );

    await client.query(
      `UPDATE worker_shift_assignments
       SET is_active = false,
           effective_to = COALESCE(effective_to, CURRENT_DATE),
           updated_at = NOW()
       WHERE company_id = $1
         AND shift_id = $2
         AND is_active = true
         AND effective_to IS NULL`,
      [companyId, shiftId]
    );

    await logAudit({
      userId,
      companyId,
      module: 'SCHEDULE',
      action: 'DELETE_SHIFT',
      entity: 'shifts',
      entityId: shiftId,
      oldData: previous,
      req: req || {}
    });

    return true;
  });
}

async function ensureWorker(companyId, workerId, client = null) {
  const db = getDb(client);
  const result = await db.query(
    `SELECT w.*, CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name, u.email
     FROM workers w
     JOIN users u ON u.id = w.user_id
     WHERE w.id = $1
       AND w.company_id = $2
       AND w.deleted_at IS NULL
     LIMIT 1`,
    [workerId, companyId]
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'WORKER_NOT_FOUND', 'Trabajador no encontrado.');
  }

  return result.rows[0];
}

function serializeAssignment(row, shift = null, worker = null) {
  if (!row) return null;
  const startDate = row.effective_from ? normalizeDate(row.effective_from) : null;
  const endDate = row.effective_to ? normalizeDate(row.effective_to) : null;
  const mappedShift = shift || row.shift || null;
  const workerAvatarUrl = row.worker_avatar_url || worker?.profile_photo_url || null;
  const workerName = row.worker_name || worker?.worker_name || null;
  const workerEmail = row.worker_email || worker?.email || null;

  return {
    ...row,
    workerId: row.worker_id,
    worker_id: row.worker_id,
    workerName,
    worker_name: workerName,
    workerEmail,
    worker_email: workerEmail,
    workerAvatarUrl,
    worker_avatar_url: workerAvatarUrl,
    worker: {
      id: row.worker_id,
      name: workerName,
      email: workerEmail,
      profilePhotoUrl: workerAvatarUrl,
      profile_photo_url: workerAvatarUrl
    },
    shiftId: row.shift_id,
    shift_id: row.shift_id,
    shiftName: mappedShift?.name || row.shift_name || null,
    shift_name: mappedShift?.name || row.shift_name || null,
    startDate,
    start_date: startDate,
    effective_from: row.effective_from,
    endDate,
    end_date: endDate,
    effective_to: row.effective_to,
    isActive: row.is_active !== false,
    is_active: row.is_active !== false,
    shift: mappedShift
  };
}

async function findOverlappingAssignment(client, companyId, workerId, startDate, endDate, currentAssignmentId = null) {
  const result = await client.query(
    `SELECT id, effective_from, effective_to
     FROM worker_shift_assignments
     WHERE company_id = $1
       AND worker_id = $2
       AND is_active = true
       AND effective_from <= COALESCE($4::date, 'infinity'::date)
       AND COALESCE(effective_to, 'infinity'::date) >= $3::date
       AND ($5::uuid IS NULL OR id <> $5::uuid)
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [companyId, workerId, startDate, endDate, currentAssignmentId]
  );

  return result.rows[0] || null;
}

async function assignShift(companyId, workerId, shiftId, data = {}, userId = null, req = null) {
  return withTransaction(async (client) => {
    const policy = await ensurePolicy(companyId, client);
    const worker = await ensureWorker(companyId, workerId, client);
    const shiftResult = await client.query(
      `SELECT *
       FROM shifts
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
         AND COALESCE(is_active, true) = true
       LIMIT 1`,
      [shiftId, companyId]
    );
    const shift = mapShift(shiftResult.rows[0], policy);
    if (!shift) {
      throw createHttpError(404, 'SHIFT_NOT_FOUND', 'Turno no encontrado o inactivo.');
    }

    const effectiveFrom = normalizeDate(
      data.startDate ?? data.start_date ?? data.effective_from ?? data.effectiveFrom,
      policy.timezone
    );
    const endDateValue = data.endDate ?? data.end_date ?? data.effective_to ?? data.effectiveTo;
    const effectiveTo = endDateValue ? normalizeDate(endDateValue, policy.timezone) : null;
    if (effectiveTo && moment(effectiveTo).isBefore(moment(effectiveFrom), 'day')) {
      throw createHttpError(400, 'INVALID_ASSIGNMENT_DATES', 'La fecha fin no puede ser anterior a la fecha de inicio.');
    }

    const overlap = await findOverlappingAssignment(client, companyId, workerId, effectiveFrom, effectiveTo);
    if (overlap) {
      throw createHttpError(400, 'SCHEDULE_ASSIGNMENT_OVERLAP', 'El trabajador ya tiene un turno asignado en ese rango de fechas.', {
        workerId,
        existingAssignmentId: overlap.id,
        existingStartDate: normalizeDate(overlap.effective_from, policy.timezone),
        existingEndDate: overlap.effective_to ? normalizeDate(overlap.effective_to, policy.timezone) : null,
        newStartDate: effectiveFrom,
        newEndDate: effectiveTo
      });
    }

    await client.query(
      `UPDATE worker_shift_assignments
       SET is_active = false,
           effective_to = CASE
             WHEN effective_from < $3::date THEN ($3::date - INTERVAL '1 day')::date
             ELSE effective_from
           END,
           updated_at = NOW()
       WHERE company_id = $1
         AND worker_id = $2
         AND is_active = true
         AND effective_to IS NULL`,
      [companyId, workerId, effectiveFrom]
    );

    const assignmentResult = await client.query(
      `INSERT INTO worker_shift_assignments (
         company_id, worker_id, shift_id, effective_from, effective_to, is_active, notes, assigned_by
       )
       VALUES ($1, $2, $3, $4::date, $5::date, true, $6, $7)
       RETURNING *`,
      [companyId, workerId, shiftId, effectiveFrom, effectiveTo, data.notes || null, userId]
    );

    await client.query(
      `UPDATE workers
       SET shift_id = $1, updated_at = NOW()
       WHERE id = $2
         AND company_id = $3`,
      [shiftId, workerId, companyId]
    );

    await client.query(
      `INSERT INTO worker_shifts (worker_id, shift_id, company_id, assigned_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (worker_id, shift_id)
       DO UPDATE SET assigned_at = EXCLUDED.assigned_at,
                     company_id = COALESCE(worker_shifts.company_id, EXCLUDED.company_id)`,
      [workerId, shiftId, companyId]
    );

    const assignment = serializeAssignment({
      ...assignmentResult.rows[0],
      worker_name: worker.worker_name,
      worker_email: worker.email,
      shift_id: shift.id
    }, shift, worker);

    await logAudit({
      userId,
      companyId,
      module: 'SCHEDULE',
      action: 'ASSIGN_SHIFT',
      entity: 'worker_shift_assignments',
      entityId: assignment.id,
      newData: assignment,
      req: req || {}
    });

    return assignment;
  });
}

async function getAssignmentById(companyId, assignmentId, client = null) {
  const db = getDb(client);
  const result = await db.query(
    `SELECT wsa.*,
            CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
            u.email AS worker_email,
            COALESCE(w.profile_photo_url, u.profile_photo_url) AS worker_avatar_url,
            s.name AS shift_name,
            s.start_time,
            s.end_time,
            s.tolerance_minutes,
            s.effective_minutes,
            s.break_minutes,
            s.break_paid,
            s.weekly_target_minutes,
            s.timezone,
            s.working_days,
            s.allows_overtime,
            s.is_active AS shift_is_active,
            s.status AS shift_status
     FROM worker_shift_assignments wsa
     JOIN workers w ON w.id = wsa.worker_id AND w.company_id = wsa.company_id
     JOIN users u ON u.id = w.user_id
     LEFT JOIN shifts s ON s.id = wsa.shift_id AND s.company_id = wsa.company_id
     WHERE wsa.id = $1
       AND wsa.company_id = $2
     LIMIT 1`,
    [assignmentId, companyId]
  );

  return result.rows[0] || null;
}

async function updateAssignment(companyId, assignmentId, data = {}, userId = null, req = null) {
  return withTransaction(async (client) => {
    const policy = await ensurePolicy(companyId, client);
    const current = await getAssignmentById(companyId, assignmentId, client);

    if (!current) {
      throw createHttpError(404, 'SCHEDULE_ASSIGNMENT_NOT_FOUND', 'Asignacion de turno no encontrada.');
    }

    const workerId = firstProvided(data, ['workerId', 'worker_id']) || current.worker_id;
    const shiftId = firstProvided(data, ['shiftId', 'shift_id']) || current.shift_id;
    const worker = await ensureWorker(companyId, workerId, client);

    const shiftResult = await client.query(
      `SELECT *
       FROM shifts
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
         AND COALESCE(is_active, true) = true
       LIMIT 1`,
      [shiftId, companyId]
    );
    const shift = mapShift(shiftResult.rows[0], policy);
    if (!shift) {
      throw createHttpError(404, 'SHIFT_NOT_FOUND', 'Turno no encontrado o inactivo.');
    }

    const startValue = firstProvided(data, ['startDate', 'start_date', 'effectiveFrom', 'effective_from']);
    const effectiveFrom = startValue !== undefined
      ? normalizeDate(startValue, policy.timezone)
      : normalizeDate(current.effective_from, policy.timezone);

    const endValue = firstProvided(data, ['endDate', 'end_date', 'effectiveTo', 'effective_to']);
    const effectiveTo = endValue !== undefined
      ? (endValue ? normalizeDate(endValue, policy.timezone) : null)
      : (current.effective_to ? normalizeDate(current.effective_to, policy.timezone) : null);

    if (effectiveTo && moment(effectiveTo).isBefore(moment(effectiveFrom), 'day')) {
      throw createHttpError(400, 'INVALID_ASSIGNMENT_DATES', 'La fecha fin no puede ser anterior a la fecha de inicio.');
    }

    const isActiveValue = firstProvided(data, ['isActive', 'is_active']);
    const isActive = isActiveValue !== undefined ? toBoolean(isActiveValue, true) : current.is_active !== false;
    const notes = firstProvided(data, ['notes']) !== undefined ? data.notes : current.notes;

    if (isActive) {
      const overlap = await findOverlappingAssignment(client, companyId, workerId, effectiveFrom, effectiveTo, assignmentId);
      if (overlap) {
        throw createHttpError(400, 'SCHEDULE_ASSIGNMENT_OVERLAP', 'El trabajador ya tiene un turno asignado en ese rango de fechas.', {
          workerId,
          existingAssignmentId: overlap.id,
          existingStartDate: normalizeDate(overlap.effective_from, policy.timezone),
          existingEndDate: overlap.effective_to ? normalizeDate(overlap.effective_to, policy.timezone) : null,
          newStartDate: effectiveFrom,
          newEndDate: effectiveTo
        });
      }
    }

    const updateResult = await client.query(
      `UPDATE worker_shift_assignments
       SET worker_id = $3,
           shift_id = $4,
           effective_from = $5::date,
           effective_to = $6::date,
           is_active = $7,
           notes = $8,
           updated_at = NOW()
       WHERE id = $1
         AND company_id = $2
       RETURNING *`,
      [assignmentId, companyId, workerId, shiftId, effectiveFrom, effectiveTo, isActive, notes || null]
    );

    if (isActive) {
      await client.query(
        `UPDATE workers
         SET shift_id = $1, updated_at = NOW()
         WHERE id = $2
           AND company_id = $3`,
        [shiftId, workerId, companyId]
      );

      await client.query(
        `INSERT INTO worker_shifts (worker_id, shift_id, company_id, assigned_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (worker_id, shift_id)
         DO UPDATE SET assigned_at = EXCLUDED.assigned_at,
                       company_id = COALESCE(worker_shifts.company_id, EXCLUDED.company_id)`,
        [workerId, shiftId, companyId]
      );
    }

    const updated = serializeAssignment({
      ...updateResult.rows[0],
      worker_name: worker.worker_name,
      worker_email: worker.email,
      worker_avatar_url: worker.profile_photo_url || current.worker_avatar_url || null,
      shift_id: shift.id
    }, shift, worker);

    await logAudit({
      userId,
      companyId,
      module: 'SCHEDULE',
      action: 'UPDATE_ASSIGNMENT',
      entity: 'worker_shift_assignments',
      entityId: updated.id,
      oldData: current,
      newData: updated,
      req: req || {}
    });

    return updated;
  });
}

async function listAssignments(companyId, filters = {}) {
  const params = [companyId];
  const where = ['wsa.company_id = $1'];
  let index = 2;

  if (filters.worker_id || filters.workerId) {
    where.push(`wsa.worker_id = $${index}`);
    params.push(filters.worker_id || filters.workerId);
    index += 1;
  }

  if (filters.shift_id || filters.shiftId) {
    where.push(`wsa.shift_id = $${index}`);
    params.push(filters.shift_id || filters.shiftId);
    index += 1;
  }

  if (!toBoolean(filters.include_inactive ?? filters.includeInactive, false)) {
    where.push('wsa.is_active = true');
  }

  const result = await query(
    `SELECT wsa.*,
            CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
            u.email AS worker_email,
            COALESCE(w.profile_photo_url, u.profile_photo_url) AS worker_avatar_url,
            s.name AS shift_name,
            s.start_time,
            s.end_time,
            s.tolerance_minutes,
            s.effective_minutes,
            s.break_minutes,
            s.break_paid,
            s.weekly_target_minutes,
            s.timezone,
            s.working_days,
            s.allows_overtime,
            s.is_active AS shift_is_active,
            s.status AS shift_status
     FROM worker_shift_assignments wsa
     JOIN workers w ON w.id = wsa.worker_id AND w.company_id = wsa.company_id
     JOIN users u ON u.id = w.user_id
     JOIN shifts s ON s.id = wsa.shift_id AND s.company_id = wsa.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY wsa.effective_from DESC, wsa.created_at DESC`,
    params
  );

  const policy = await ensurePolicy(companyId);
  return result.rows.map((row) => {
    const shift = mapShift({
      id: row.shift_id,
      company_id: row.company_id,
      name: row.shift_name,
      start_time: row.start_time,
      end_time: row.end_time,
      tolerance_minutes: row.tolerance_minutes,
      effective_minutes: row.effective_minutes,
      break_minutes: row.break_minutes,
      break_paid: row.break_paid,
      weekly_target_minutes: row.weekly_target_minutes,
      timezone: row.timezone,
      working_days: row.working_days,
      allows_overtime: row.allows_overtime,
      is_active: row.shift_is_active,
      status: row.shift_status
    }, policy);

    return serializeAssignment(row, shift);
  });
}

async function resolveWorkerSchedule(workerId, companyId, dateValue = null, client = null) {
  const db = getDb(client);
  const policy = await ensurePolicy(companyId, client);
  const date = normalizeDate(dateValue, policy.timezone);
  const result = await db.query(
    `WITH candidate_shifts AS (
       SELECT
         s.*,
         wsa.id AS assignment_id,
         wsa.effective_from,
         wsa.effective_to,
         wsa.created_at AS assigned_at,
         'worker_shift_assignments' AS assignment_source,
         1 AS source_priority
       FROM worker_shift_assignments wsa
       JOIN shifts s ON s.id = wsa.shift_id AND s.company_id = wsa.company_id
       WHERE wsa.worker_id = $1
         AND wsa.company_id = $2
         AND wsa.effective_from <= $3::date
         AND (wsa.effective_to IS NULL OR wsa.effective_to >= $3::date)
         AND wsa.is_active = true
         AND s.deleted_at IS NULL
         AND COALESCE(s.is_active, true) = true

       UNION ALL

       SELECT
         s.*,
         NULL::uuid AS assignment_id,
         NULL::date AS effective_from,
         NULL::date AS effective_to,
         NULL::timestamptz AS assigned_at,
         'workers.shift_id' AS assignment_source,
         2 AS source_priority
       FROM workers w
       JOIN shifts s ON s.id = w.shift_id
       WHERE w.id = $1
         AND w.company_id = $2
         AND s.company_id = $2
         AND s.deleted_at IS NULL
         AND COALESCE(s.is_active, true) = true

       UNION ALL

       SELECT
         s.*,
         NULL::uuid AS assignment_id,
         ws.assigned_at::date AS effective_from,
         NULL::date AS effective_to,
         ws.assigned_at,
         'worker_shifts' AS assignment_source,
         3 AS source_priority
       FROM worker_shifts ws
       JOIN shifts s ON s.id = ws.shift_id
       WHERE ws.worker_id = $1
         AND COALESCE(ws.company_id, $2) = $2
         AND s.company_id = $2
         AND s.deleted_at IS NULL
         AND COALESCE(s.is_active, true) = true
     )
     SELECT *
     FROM candidate_shifts
     ORDER BY source_priority ASC, effective_from DESC NULLS LAST, assigned_at DESC NULLS LAST
     LIMIT 1`,
    [workerId, companyId, date]
  );

  const shift = mapShift(result.rows[0], policy);
  const timezone = shift?.timezone || policy.timezone || DEFAULT_TIMEZONE;
  const workingDays = shift?.workingDaysNames?.length
    ? shift.workingDaysNames
    : (policy.workingDaysNames || policy.working_days || DEFAULT_WORKING_DAYS);
  const dayName = getDayName(date, timezone);
  const dayOfWeek = DAY_NAME_TO_NUMBER[dayName] || getDayOfWeek(date, timezone);
  const isWorkingDay = workingDays.includes(dayName);
  const expectedMinutes = shift && isWorkingDay ? Number(shift.effectiveMinutes || policy.defaultEffectiveMinutes || 480) : 0;
  const shiftMoments = shift ? buildShiftMoments(date, shift, timezone) : null;
  const assignmentSource = result.rows[0]?.assignment_source || null;

  return {
    date,
    companyId,
    workerId,
    policy,
    shift,
    assignment: result.rows[0]?.assignment_id ? {
      id: result.rows[0].assignment_id,
      source: assignmentSource,
      effective_from: result.rows[0].effective_from,
      effective_to: result.rows[0].effective_to,
      startDate: normalizeDate(result.rows[0].effective_from, timezone),
      start_date: normalizeDate(result.rows[0].effective_from, timezone),
      endDate: result.rows[0].effective_to ? normalizeDate(result.rows[0].effective_to, timezone) : null,
      end_date: result.rows[0].effective_to ? normalizeDate(result.rows[0].effective_to, timezone) : null,
      assigned_at: result.rows[0].assigned_at
    } : (result.rows[0] ? { source: assignmentSource } : null),
    source: assignmentSource === 'worker_shift_assignments'
      ? 'assignment'
      : (assignmentSource || null),
    dayOfWeek,
    dayName,
    timezone,
    workingDays,
    workingDaysNames: workingDays,
    workingDaysNumbers: normalizeWorkingDays(workingDays, DEFAULT_WORKING_DAYS).numbers,
    isWorkingDay,
    expectedMinutes,
    scheduledCheckIn: shiftMoments?.scheduledCheckIn?.toDate() || null,
    scheduledCheckOut: shiftMoments?.scheduledCheckOut?.toDate() || null
  };
}

async function resolveWorkerScheduleForDate({ companyId, workerId, date, client = null }) {
  return resolveWorkerSchedule(workerId, companyId, date, client);
}

function calculateAttendanceMetrics({ schedule, checkInTime = null, checkOutTime = null, now = null, status = null }) {
  const shift = schedule?.shift;
  const policy = schedule?.policy;
  const timezone = shift?.timezone || policy?.timezone || DEFAULT_TIMEZONE;
  const shiftMoments = shift ? buildShiftMoments(schedule.date, shift, timezone) : null;
  const checkIn = checkInTime
    ? parseAttendanceMoment(checkInTime, schedule?.date, timezone)
    : (now ? parseAttendanceMoment(now, schedule?.date, timezone) : null);
  const checkOut = checkOutTime ? parseAttendanceMoment(checkOutTime, schedule?.date, timezone) : null;
  const toleranceMinutes = Number(shift?.toleranceMinutes ?? policy?.lateToleranceMinutes ?? 5);
  const breakMinutes = Number(shift?.breakMinutes ?? policy?.defaultBreakMinutes ?? 0);
  const breakPaid = shift?.breakPaid === true;
  const expectedMinutes = Number(schedule?.expectedMinutes || shift?.effectiveMinutes || policy?.defaultEffectiveMinutes || 0);

  let lateMinutes = 0;
  let computedStatus = status || 'present';

  if (checkIn && shiftMoments?.scheduledCheckIn) {
    const toleranceLimit = shiftMoments.scheduledCheckIn.clone().add(toleranceMinutes, 'minutes');
    if (checkIn.isAfter(toleranceLimit)) {
      computedStatus = 'late';
      lateMinutes = Math.max(checkIn.diff(shiftMoments.scheduledCheckIn, 'minutes'), 0);
    }
  }

  let workedMinutes = null;
  let effectiveWorkedMinutes = null;
  let overtimeMinutes = 0;
  let earlyLeaveMinutes = 0;

  if (checkInTime && checkOutTime) {
    const start = parseAttendanceMoment(checkInTime, schedule?.date, timezone);
    const end = parseAttendanceMoment(checkOutTime, schedule?.date, timezone);
    if (start?.isValid() && end?.isValid() && end.isBefore(start)) {
      end.add(1, 'day');
    }
    workedMinutes = Math.max(end.diff(start, 'minutes'), 0);

    const unpaidBreakDeduction = breakPaid
      ? 0
      : Math.min(breakMinutes, Math.max(workedMinutes - expectedMinutes, 0));
    effectiveWorkedMinutes = Math.max(workedMinutes - unpaidBreakDeduction, 0);

    if (shiftMoments?.scheduledCheckOut) {
      overtimeMinutes = Math.max(end.diff(shiftMoments.scheduledCheckOut, 'minutes'), 0);
      earlyLeaveMinutes = Math.max(shiftMoments.scheduledCheckOut.diff(end, 'minutes'), 0);
    }
  }

  return {
    status: computedStatus,
    scheduledCheckIn: shiftMoments?.scheduledCheckIn?.toDate() || null,
    scheduledCheckOut: shiftMoments?.scheduledCheckOut?.toDate() || null,
    toleranceMinutes,
    expectedMinutes,
    breakMinutes,
    breakPaid,
    lateMinutes,
    workedMinutes,
    effectiveWorkedMinutes,
    overtimeMinutes,
    earlyLeaveMinutes,
    calculationDetails: {
      policyId: policy?.id || null,
      shiftId: shift?.id || null,
      timezone,
      expectedMinutes,
      breakMinutes,
      breakPaid,
      toleranceMinutes,
      calculatedAt: new Date().toISOString()
    }
  };
}

async function getWorkerSchedule(companyId, workerId, dateValue = null) {
  const worker = await ensureWorker(companyId, workerId);
  const schedule = await resolveWorkerSchedule(workerId, companyId, dateValue);

  return {
    worker: {
      id: worker.id,
      name: worker.worker_name,
      email: worker.email,
      hire_date: worker.hire_date,
      status: worker.status,
      is_active: worker.is_active
    },
    ...schedule
  };
}

async function getWorkerIdForUser(companyId, userId) {
  const result = await query(
    `SELECT id
     FROM workers
     WHERE user_id = $1
       AND company_id = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId, companyId]
  );
  return result.rows[0]?.id || null;
}

async function getMySchedule(companyId, userId, dateValue = null) {
  const workerId = await getWorkerIdForUser(companyId, userId);
  if (!workerId) {
    return null;
  }

  return getWorkerSchedule(companyId, workerId, dateValue);
}

async function getAttendanceSummary(companyId, filters = {}) {
  const startDate = normalizeDate(filters.start_date || filters.startDate || moment().startOf('month').format('YYYY-MM-DD'));
  const endDate = normalizeDate(filters.end_date || filters.endDate || moment().endOf('month').format('YYYY-MM-DD'));
  const params = [companyId, startDate, endDate];
  let workerFilter = '';

  if (filters.worker_id || filters.workerId) {
    params.push(filters.worker_id || filters.workerId);
    workerFilter = ` AND ar.worker_id = $${params.length}`;
  }

  const result = await query(
    `SELECT
       ar.worker_id,
       CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
       u.email,
       COUNT(*)::int AS total_records,
       COUNT(*) FILTER (WHERE ar.status = 'absent')::int AS absent_days,
       COUNT(*) FILTER (WHERE ar.status = 'late')::int AS late_days,
       COALESCE(SUM(COALESCE(ar.late_minutes, 0)), 0)::int AS late_minutes,
       COALESCE(SUM(COALESCE(ar.expected_minutes, 0)), 0)::int AS expected_minutes,
       COALESCE(SUM(COALESCE(ar.effective_worked_minutes, ar.worked_minutes, 0)), 0)::int AS effective_worked_minutes,
       COALESCE(SUM(COALESCE(ar.worked_minutes, 0)), 0)::int AS worked_minutes
     FROM attendance_records ar
     JOIN workers w ON w.id = ar.worker_id AND w.company_id = ar.company_id
     JOIN users u ON u.id = w.user_id
     WHERE ar.company_id = $1
       AND ar.date >= $2::date
       AND ar.date <= $3::date
       ${workerFilter}
     GROUP BY ar.worker_id, u.first_name, u.last_name, u.email
     ORDER BY worker_name ASC`,
    params
  );

  const records = await Promise.all(result.rows.map(async (row) => {
    let schedule = null;
    try {
      schedule = await resolveWorkerSchedule(row.worker_id, companyId, endDate);
    } catch (error) {
      schedule = null;
    }

    return {
      ...row,
      expected_hours: Number((Number(row.expected_minutes || 0) / 60).toFixed(2)),
      worked_hours: Number((Number(row.worked_minutes || 0) / 60).toFixed(2)),
      effective_worked_hours: Number((Number(row.effective_worked_minutes || 0) / 60).toFixed(2)),
      schedule: schedule ? {
        date: schedule.date,
        source: schedule.source,
        assignment: schedule.assignment,
        shift: schedule.shift,
        dayOfWeek: schedule.dayOfWeek,
        dayName: schedule.dayName,
        timezone: schedule.timezone,
        isWorkingDay: schedule.isWorkingDay
      } : null,
      shift: schedule?.shift || null
    };
  }));

  return {
    start_date: startDate,
    end_date: endDate,
    records
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_WORKING_DAYS,
  createHttpError,
  normalizeDate,
  normalizeTime,
  parseWorkingDays,
  normalizeWorkingDays,
  calculatePresenceMinutes,
  calculateEffectiveMinutes,
  getDayOfWeek,
  buildShiftMoments,
  mapPolicy,
  serializePolicy,
  mapShift,
  getPolicy,
  updatePolicy,
  listShifts,
  getShift,
  createShift,
  updateShift,
  deleteShift,
  assignShift,
  updateAssignment,
  listAssignments,
  serializeAssignment,
  findOverlappingAssignment,
  resolveWorkerSchedule,
  resolveWorkerScheduleForDate,
  calculateAttendanceMetrics,
  getWorkerSchedule,
  getMySchedule,
  getWorkerIdForUser,
  getAttendanceSummary
};
