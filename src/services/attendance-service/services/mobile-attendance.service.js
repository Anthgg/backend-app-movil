const moment = require('moment-timezone');
const { query } = require('../../../config/database');

const TIMEZONE = process.env.TZ || 'America/Lima';

function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return moment(value).tz(TIMEZONE).format('YYYY-MM-DD');
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

function buildShiftMoments(dateValue, shift) {
  if (!shift?.startTime || !shift?.endTime) {
    return null;
  }

  const dateStr = formatDateOnly(dateValue) || moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const scheduledCheckIn = moment.tz(`${dateStr} ${shift.startTime}:00`, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
  let scheduledCheckOut = moment.tz(`${dateStr} ${shift.endTime}:00`, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);

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

function formatShift(row) {
  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    startTime: formatTimeOnly(row.start_time),
    endTime: formatTimeOnly(row.end_time),
    toleranceMinutes: Number(row.tolerance_minutes || 0)
  };
}

async function getWorkerShift(workerId, tenantId) {
  if (!workerId || !tenantId) {
    return null;
  }

  const result = await query(`
    SELECT
      s.id,
      s.name,
      s.start_time,
      s.end_time,
      s.tolerance_minutes
    FROM worker_shifts ws
    JOIN shifts s
      ON s.id = ws.shift_id
    WHERE ws.worker_id = $1
      AND ws.company_id = $2
      AND s.company_id = $2
    ORDER BY ws.assigned_at DESC
    LIMIT 1
  `, [workerId, tenantId]);

  return formatShift(result.rows[0] || null);
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
    date: formatDateOnly(dateValue),
    shift,
    shiftName: shift?.name || null,
    scheduledCheckIn: shift?.startTime || null,
    scheduledCheckOut: shift?.endTime || null,
    toleranceMinutes,
    lateMinutes,
    overtimeHours: roundHours(overtimeMinutes / 60),
    earlyExit,
    earlyExitMinutes,
    canCheckIn: workflowStatus === 'none',
    canCheckOut: workflowStatus === 'checked_in',
    projectId: record?.project_id || null,
    projectName: record?.project_name || null,
    profilePhotoUrl: record?.profile_photo_url || null,
    photoUrl: record?.check_in_photo_url || record?.photo_url || null,
    latitude: record?.check_in_latitude || null,
    longitude: record?.check_in_longitude || null,
    late_minutes: lateMinutes,
    worked_hours: workedHours,
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
