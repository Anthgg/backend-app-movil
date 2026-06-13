const moment = require('moment-timezone');
const scheduleService = require('../../schedule-service/services/laborSchedule.service');

const TIMEZONE = process.env.TZ || 'America/Lima';

function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function formatTimeOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 5);
  }

  return moment(value).tz(TIMEZONE).format('HH:mm');
}

function roundHours(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getWorkedHours(record) {
  if (record.worked_hours !== undefined && record.worked_hours !== null) {
    return roundHours(record.worked_hours);
  }

  if (record.hours_worked !== undefined && record.hours_worked !== null) {
    return roundHours(record.hours_worked);
  }

  if (record.worked_minutes !== undefined && record.worked_minutes !== null) {
    return roundHours(record.worked_minutes / 60);
  }

  if (record.check_in_time && record.check_out_time) {
    const minutes = moment(record.check_out_time).diff(moment(record.check_in_time), 'minutes');
    return roundHours(minutes / 60);
  }

  return 0;
}

function getEffectiveWorkedHours(record) {
  if (record.effective_worked_minutes !== undefined && record.effective_worked_minutes !== null) {
    return roundHours(record.effective_worked_minutes / 60);
  }

  return getWorkedHours(record);
}

function buildShiftMoments(dateValue, shift) {
  if (!shift?.startTime || !shift?.endTime) {
    return null;
  }

  const timezone = shift.timezone || TIMEZONE;
  const dateStr = formatDateOnly(dateValue) || moment().tz(timezone).format('YYYY-MM-DD');
  const scheduledCheckIn = moment.tz(`${dateStr} ${shift.startTime}:00`, 'YYYY-MM-DD HH:mm:ss', timezone);
  let scheduledCheckOut = moment.tz(`${dateStr} ${shift.endTime}:00`, 'YYYY-MM-DD HH:mm:ss', timezone);

  if (scheduledCheckOut.isSameOrBefore(scheduledCheckIn)) {
    scheduledCheckOut.add(1, 'day');
  }

  return { scheduledCheckIn, scheduledCheckOut };
}

function getArrivalStatus(checkInMoment, shiftMoments, toleranceMinutes) {
  if (!checkInMoment || !shiftMoments) {
    return null;
  }

  const toleranceLimit = shiftMoments.scheduledCheckIn.clone().add(toleranceMinutes || 0, 'minutes');
  if (checkInMoment.isAfter(toleranceLimit)) {
    return 'late';
  }

  if (checkInMoment.isAfter(shiftMoments.scheduledCheckIn)) {
    return 'within_tolerance';
  }

  return 'on_time';
}

function getLateMinutes(checkInMoment, shiftMoments, storedLateMinutes = 0) {
  if (storedLateMinutes) {
    return Number(storedLateMinutes);
  }

  if (!checkInMoment || !shiftMoments) {
    return 0;
  }

  return Math.max(checkInMoment.diff(shiftMoments.scheduledCheckIn, 'minutes'), 0);
}

function getEarlyExitMinutes(checkOutMoment, shiftMoments) {
  if (!checkOutMoment || !shiftMoments) {
    return 0;
  }

  return Math.max(shiftMoments.scheduledCheckOut.diff(checkOutMoment, 'minutes'), 0);
}

function getOvertimeMinutes(checkOutMoment, shiftMoments, storedOvertimeMinutes = 0) {
  if (storedOvertimeMinutes) {
    return Number(storedOvertimeMinutes);
  }

  if (!checkOutMoment || !shiftMoments) {
    return 0;
  }

  return Math.max(checkOutMoment.diff(shiftMoments.scheduledCheckOut, 'minutes'), 0);
}

function mapShiftRow(row) {
  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    name: row.name || row.nombre || 'Turno asignado',
    startTime: formatTimeOnly(row.start_time || row.entry_time || row.hora_inicio),
    endTime: formatTimeOnly(row.end_time || row.exit_time || row.hora_fin),
    toleranceMinutes: Number(
      row.tolerance_minutes ??
      row.tolerance ??
      row.grace_minutes ??
      0
    ),
    effectiveMinutes: Number(row.effective_minutes ?? row.effectiveMinutes ?? 0),
    breakMinutes: Number(row.break_minutes ?? row.breakMinutes ?? 0),
    breakPaid: row.break_paid === true || row.breakPaid === true,
    weeklyTargetMinutes: Number(row.weekly_target_minutes ?? row.weeklyTargetMinutes ?? 0),
    timezone: row.timezone || TIMEZONE
  };
}

async function getWorkerShift(workerId, tenantId) {
  if (!workerId || !tenantId) {
    return null;
  }

  const schedule = await scheduleService.resolveWorkerSchedule(workerId, tenantId);
  return schedule.shift;
}

function serializeAttendanceRecord(record, options = {}) {
  const todayDate = options.todayDate || moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const dateValue = record?.date || todayDate;
  const shift = options.shift || null;
  const shiftMoments = buildShiftMoments(dateValue, shift);
  const checkInMoment = record?.check_in_time ? moment(record.check_in_time).tz(TIMEZONE) : null;
  const checkOutMoment = record?.check_out_time ? moment(record.check_out_time).tz(TIMEZONE) : null;
  const toleranceMinutes = Number(shift?.toleranceMinutes || 0);
  const arrivalStatus = getArrivalStatus(checkInMoment, shiftMoments, toleranceMinutes);
  const lateMinutes = getLateMinutes(checkInMoment, shiftMoments, record?.late_minutes || 0);
  const overtimeMinutes = getOvertimeMinutes(checkOutMoment, shiftMoments, record?.overtime_minutes || 0);
  const earlyExitMinutes = getEarlyExitMinutes(checkOutMoment, shiftMoments);
  const workedHours = getWorkedHours(record || {});
  const effectiveWorkedHours = getEffectiveWorkedHours(record || {});
  const earlyExit = earlyExitMinutes > 0;

  let workflowStatus = 'none';
  if (checkInMoment && !checkOutMoment) {
    workflowStatus = 'checked_in';
  } else if (checkInMoment && checkOutMoment) {
    workflowStatus = 'checked_out';
  }

  let attendanceStatus = 'none';
  if (workflowStatus === 'checked_in') {
    attendanceStatus = arrivalStatus || 'checked_in';
  } else if (workflowStatus === 'checked_out') {
    if (earlyExit) {
      attendanceStatus = 'early_exit';
    } else if (arrivalStatus === 'late') {
      attendanceStatus = 'late';
    } else if (arrivalStatus === 'within_tolerance') {
      attendanceStatus = 'within_tolerance';
    } else {
      attendanceStatus = 'checked_out';
    }
  }

  return {
    id: record?.id || null,
    status: workflowStatus,
    attendanceStatus,
    arrivalStatus,
    checkIn: record?.check_in_time || null,
    checkOut: record?.check_out_time || null,
    workedHours,
    effectiveWorkedHours,
    date: formatDateOnly(dateValue),
    shift,
    shiftName: shift?.name || null,
    scheduledCheckIn: shift?.startTime || null,
    scheduledCheckOut: shift?.endTime || null,
    scheduledCheckInAt: record?.scheduled_check_in || null,
    scheduledCheckOutAt: record?.scheduled_check_out || null,
    toleranceMinutes,
    expectedMinutes: record?.expected_minutes ?? shift?.effectiveMinutes ?? null,
    breakMinutes: record?.break_minutes ?? shift?.breakMinutes ?? null,
    breakPaid: record?.break_paid ?? shift?.breakPaid ?? null,
    lateMinutes,
    overtimeHours: roundHours(overtimeMinutes / 60),
    earlyExit,
    earlyExitMinutes,
    canCheckIn: workflowStatus === 'none',
    canCheckOut: workflowStatus === 'checked_in',
    message: !record && !shift ? 'Trabajador sin turno asignado' : null,
    projectId: record?.project_id || null,
    projectName: record?.project_name || null,
    workLocationId: record?.work_location_id || null,
    workLocation: record?.work_location_name || null,
    distanceMeters: record?.check_in_distance_meters !== undefined ? Number(record.check_in_distance_meters) : null,
    allowedRadiusMeters: record?.check_in_allowed_radius_meters !== undefined ? Number(record.check_in_allowed_radius_meters) : null,
    isLocationValid: record?.check_in_location_valid ?? null,
    profilePhotoUrl: record?.profile_photo_url || null,
    photoUrl: record?.check_in_photo_url || record?.photo_url || null,
    latitude: record?.check_in_latitude || null,
    longitude: record?.check_in_longitude || null,
    late_minutes: lateMinutes,
    worked_hours: workedHours,
    effective_worked_hours: effectiveWorkedHours,
    effective_worked_minutes: record?.effective_worked_minutes ?? null,
    check_in: record?.check_in_time || null,
    check_out: record?.check_out_time || null
  };
}

module.exports = {
  TIMEZONE,
  formatDateOnly,
  formatTimeOnly,
  getWorkerShift,
  serializeAttendanceRecord
};
