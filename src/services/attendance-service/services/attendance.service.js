const repo = require('../repositories/attendance.repository');
const env = require('../../../config/env');
const { validateAttendanceDeviceAndTenant } = require('../../../shared/utils/validators');
const geo = require('../../../shared/utils/geolocation.utils');
const storage = require('../../../shared/utils/storage.utils');
const moment = require('moment-timezone');
const { TIMEZONE } = require('./mobile-attendance.service');
const logger = require('../../../shared/utils/logger');
const { detectClientDevice } = require('../../../shared/utils/client-platform.util');
const { getActiveWorkLocationForWorker } = require('../../../shared/services/worker-location-assignment.service');
const scheduleService = require('../../schedule-service/services/laborSchedule.service');
const { getClientIp } = require('../../../shared/utils/device-parser');
const {
  createAttendanceError,
  buildAttendanceMoment,
  normalizeAttendanceInput,
  normalizeAttendanceDate,
  normalizeAttendanceRequestBody,
  normalizeWorkLocationId,
  assertScheduleAllowsAttendance
} = require('./attendance-context.util');

const MAX_GPS_ACCURACY_METERS = Number(process.env.ATTENDANCE_MAX_GPS_ACCURACY_METERS || 50);

function createHttpError(statusCode, errorCode, message, extra = {}) {
  return createAttendanceError({
    status: statusCode,
    code: errorCode,
    message,
    details: extra,
    extra
  });
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getAccuracy(body = {}) {
  return normalizeNumber(body.accuracy ?? body.gps_accuracy);
}

function hasFieldValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getRequestedAttendanceDate(req) {
  return req.body?.attendanceDate ||
    req.body?.attendance_date ||
    req.body?.date ||
    req.query?.attendanceDate ||
    req.query?.attendance_date ||
    req.query?.date ||
    null;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
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

function normalizeRequestAttendanceInput(req, type, {
  fallbackDate = null,
  timezone = TIMEZONE,
  now = new Date()
} = {}) {
  const rawAttendanceTime = getRawAttendanceTime(req, type);
  const rawAttendanceDate = fallbackDate || getRequestedAttendanceDate(req);

  return {
    rawAttendanceTime,
    normalized: normalizeAttendanceInput(rawAttendanceTime, {
      fallbackDate: rawAttendanceDate,
      timezone: req.body?.timezone || req.query?.timezone || timezone,
      now,
      field: type === 'check_out' ? 'checkOutTime' : 'checkInTime'
    })
  };
}

function getMockLocationValue(body = {}) {
  return body.is_mock_location ?? body.isMockLocation;
}

function validateAttendanceLocationPayload(req) {
  const body = req.body || {};
  const missing = [];

  if (!hasFieldValue(body.latitude)) missing.push('latitude');
  if (!hasFieldValue(body.longitude)) missing.push('longitude');
  if (!hasFieldValue(body.accuracy) && !hasFieldValue(body.gps_accuracy)) missing.push('accuracy');

  if (missing.length > 0) {
    throw createHttpError(
      400,
      'VALIDATION_ERROR',
      'Faltan campos requeridos para registrar asistencia.',
      { missing }
    );
  }

  const latitude = normalizeNumber(body.latitude);
  const longitude = normalizeNumber(body.longitude);
  const accuracy = getAccuracy(body);
  const invalid = [];

  if (latitude === null) invalid.push('latitude');
  if (longitude === null) invalid.push('longitude');
  if (accuracy === null) invalid.push('accuracy');

  if (invalid.length > 0) {
    throw createHttpError(
      400,
      'VALIDATION_ERROR',
      'Los campos de ubicacion enviados no son validos.',
      { invalid }
    );
  }

  return {
    latitude,
    longitude,
    accuracy,
    isMockLocation: geo.detectMockLocation(getMockLocationValue(body))
  };
}

function getDeviceInfo(req) {
  return req.body?.device_info || req.body?.deviceInfo || req.body?.deviceContext || {
    platform: req.body?.platform || null,
    userAgent: req.headers['user-agent'] || null
  };
}

function getPhotoUrl(body = {}) {
  return body.photo_url || body.photoUrl || null;
}

function getRequestIp(req) {
  return getClientIp(req) || req.ip || null;
}

function assertMobileAttendanceClient(req, validation) {
  const client = detectClientDevice(req, validation?.device);

  if (!client.isMobile) {
    throw createHttpError(403, 'ATTENDANCE_MOBILE_ONLY', 'La marcacion de asistencia solo esta disponible desde la app movil.', {
      client_device_type: client.deviceType,
      client_platform: client.platform,
      required_client_type: 'mobile'
    });
  }

  return client;
}

async function validateAssignedWorkLocation(req, workerId, type, attendanceDate, requestedWorkLocationId, locationPayload = null) {
  const submittedLocation = locationPayload || validateAttendanceLocationPayload(req);
  const { latitude, longitude, accuracy } = submittedLocation;
  const companyId = req.tenantId;
  const targetDate = normalizeAttendanceDate(attendanceDate || getRequestedAttendanceDate(req), TIMEZONE);
  const deviceInfo = getDeviceInfo(req);
  const ipAddress = getRequestIp(req);

  let activeLocation;
  try {
    activeLocation = await getActiveWorkLocationForWorker(workerId, companyId, targetDate);
  } catch (error) {
    if (error?.errorCode === 'NO_ACTIVE_WORK_LOCATION') {
      const mapped = createHttpError(
        422,
        'WORK_LOCATION_NOT_ASSIGNED',
        'No tienes una obra o ubicacion laboral asignada para marcar asistencia.',
        { workerId, date: targetDate }
      );
      logger.logWarn('ATTENDANCE', 'mobile.attendance.work_location_not_assigned', {
        userId: req.user.id,
        workerId,
        companyId,
        date: targetDate,
        workLocationId: requestedWorkLocationId || null
      });
      throw mapped;
    }
    throw error;
  }

  const location = {
    work_location_id: activeLocation.work_location.id,
    name: activeLocation.work_location.name,
    address: activeLocation.work_location.address,
    latitude: activeLocation.work_location.latitude,
    longitude: activeLocation.work_location.longitude,
    allowed_radius_meters: activeLocation.work_location.allowed_radius_meters,
    is_active: true,
    source: activeLocation.source,
    assignment: activeLocation.assignment,
    crew: activeLocation.crew
  };

  const logAttempt = (payload) => repo.logLocationAttempt({
    company_id: companyId,
    worker_id: workerId,
    user_id: req.user.id,
    work_location_id: location?.work_location_id || null,
    type,
    latitude,
    longitude,
    accuracy,
    device_info: deviceInfo,
    ip_address: ipAddress,
    user_agent: req.headers['user-agent'],
    ...payload
  });

  if (!location?.work_location_id) {
    const message = 'No tienes una obra o ubicacion laboral asignada para marcar asistencia.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_NOT_ASSIGNED', message);
  }

  if (!location.name) {
    const message = 'El lugar de trabajo asignado no existe.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_NOT_FOUND', message);
  }

  if (!location.is_active) {
    const message = 'El lugar de trabajo asignado no esta activo.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_INACTIVE', message);
  }

  if (!geo.validateCoordinates(location.latitude, location.longitude)) {
    const message = 'La obra asignada no tiene coordenadas configuradas. Contacta al administrador.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_COORDINATES_MISSING', message);
  }

  if (requestedWorkLocationId && requestedWorkLocationId !== location.work_location_id) {
    const message = 'La ubicacion enviada no coincide con la obra asignada al trabajador.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(409, 'WORK_LOCATION_MISMATCH', message, {
      expectedWorkLocationId: location.work_location_id,
      receivedWorkLocationId: requestedWorkLocationId
    });
  }

  if (!geo.validateCoordinates(latitude, longitude)) {
    const message = 'Debe enviar coordenadas validas para registrar asistencia.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'INVALID_COORDINATES', message);
  }

  if (!geo.validateGpsAccuracy(accuracy, MAX_GPS_ACCURACY_METERS)) {
    const message = 'La precision de tu ubicacion no es suficiente para marcar asistencia.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'GPS_ACCURACY_TOO_LOW', message, {
      accuracy,
      maxAllowedAccuracy: MAX_GPS_ACCURACY_METERS
    });
  }

  const allowedRadius = Number(location.allowed_radius_meters || 100);
  const { isWithin, distance } = geo.isWithinAllowedRadius(
    latitude,
    longitude,
    location.latitude,
    location.longitude,
    allowedRadius
  );

  logger.logInfo('ATTENDANCE', 'mobile.attendance.geofence.validate', {
    userId: req.user.id,
    workerId,
    workLocationId: location.work_location_id,
    currentLatitude: latitude,
    currentLongitude: longitude,
    workLocationLatitude: location.latitude,
    workLocationLongitude: location.longitude,
    distanceMeters: distance,
    allowedRadiusMeters: allowedRadius,
    gpsAccuracy: accuracy,
    allowed: isWithin
  });

  if (!isWithin) {
    const message = 'Estas fuera del rango permitido para marcar asistencia.';
    await logAttempt({
      distance_meters: distance,
      allowed_radius_meters: allowedRadius,
      is_location_valid: false,
      validation_message: message
    });
    throw createHttpError(403, 'OUTSIDE_WORK_LOCATION_RADIUS', message, {
      distanceMeters: distance,
      allowedRadiusMeters: allowedRadius,
      workLocationName: location.name
    });
  }

  await logAttempt({
    distance_meters: distance,
    allowed_radius_meters: allowedRadius,
    is_location_valid: true,
    validation_message: 'Ubicacion validada correctamente.'
  });

  return {
    id: location.work_location_id,
    name: location.name,
    source: location.source,
    assignment: location.assignment,
    crew: location.crew,
    latitude,
    longitude,
    accuracy,
    allowed_radius_meters: allowedRadius,
    distance_meters: distance,
    device_info: deviceInfo,
    ip_address: ipAddress
  };
}

async function uploadAttendancePhoto(req, companyId, prefix = '') {
  if (!req.file) return getPhotoUrl(req.body || {});

  const timestamp = Date.now();
  const extension = req.file.mimetype.split('/')[1] || 'jpg';
  const filePath = `attendance/${companyId}/${req.user.id}/${moment().format('YYYY/MM/DD')}/${prefix}${timestamp}.${extension}`;
  return storage.uploadFile(req.file, env.attendancePhotosBucket, filePath);
}

exports.checkIn = async (req) => {
  normalizeAttendanceRequestBody(req);
  const projectId =
    req.body?.project_id ||
    req.body?.projectId ||
    req.headers['x-project-id'] ||
    req.query?.project_id ||
    req.query?.projectId ||
    null;

  const companyId = req.tenantId;
  const deviceId =
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    req.body?.device_identifier ||
    req.body?.device_id ||
    req.body?.deviceId ||
    null;

  const { notes } = req.body || {};
  const requestedWorkLocationId = normalizeWorkLocationId(req);
  const markNow = new Date();
  const initialAttendanceInput = normalizeRequestAttendanceInput(req, 'check_in', { now: markNow });
  const attendanceDate = initialAttendanceInput.normalized.date;
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId, attendanceDate);
  assertMobileAttendanceClient(req, validation);
  const workerId = validation.workerId;

  const existing = await repo.getTodayCheckIn(workerId, attendanceDate, companyId);
  if (existing) {
    throw createHttpError(409, 'ATTENDANCE_ALREADY_EXISTS', 'Ya existe una asistencia registrada hoy para este trabajador');
  }

  const schedule = await scheduleService.resolveWorkerSchedule(workerId, companyId, attendanceDate);
  let dayContext;
  try {
    dayContext = assertScheduleAllowsAttendance(schedule, attendanceDate);
  } catch (error) {
    if (error?.errorCode === 'NON_WORKING_DAY') {
      logger.logWarn('ATTENDANCE', 'mobile.attendance.non_working_day', {
        workerId,
        shiftId: error.details?.shiftId || null,
        date: error.details?.date || attendanceDate,
        day: error.details?.day || null,
        timezone: error.details?.timezone || null,
        workingDays: error.details?.workingDays || []
      });
    }
    throw error;
  }

  const locationPayload = validateAttendanceLocationPayload(req);
  logger.logInfo('ATTENDANCE', 'mobile.attendance.checkin.request', {
    userId: req.user.id,
    workerId,
    companyId,
    date: dayContext.date,
    day: dayContext.day,
    timezone: dayContext.timezone,
    workLocationId: requestedWorkLocationId || null,
    hasPhoto: Boolean(req.file || getPhotoUrl(req.body || {})),
    accuracy: locationPayload.accuracy,
    isMockLocation: locationPayload.isMockLocation
  });

  let photo_url = getPhotoUrl(req.body || {});
  if (req.file) {
    try {
      photo_url = await uploadAttendancePhoto(req, companyId);
    } catch (uploadErr) {
      console.error('Error uploading attendance photo:', uploadErr);
    }
  }

  const workLocation = await validateAssignedWorkLocation(
    req,
    workerId,
    'check_in',
    dayContext.date,
    requestedWorkLocationId,
    locationPayload
  );
  const isMock = locationPayload.isMockLocation;

  const { rawAttendanceTime, normalized: normalizedCheckIn } = normalizeRequestAttendanceInput(req, 'check_in', {
    fallbackDate: dayContext.date,
    timezone: dayContext.timezone,
    now: markNow
  });
  const checkInTime = normalizedCheckIn.time;
  const checkInMoment = buildAttendanceMoment({
    date: dayContext.date,
    time: checkInTime,
    timezone: dayContext.timezone
  });
  logger.logInfo('ATTENDANCE', 'Mobile attendance time normalized', {
    userId: req.user.id,
    workerId,
    rawAttendanceTime,
    normalizedDate: normalizedCheckIn.date,
    normalizedTime: normalizedCheckIn.time,
    sourceFormat: normalizedCheckIn.sourceFormat
  });
  const metrics = scheduleService.calculateAttendanceMetrics({
    schedule,
    now: checkInMoment.toDate(),
    status: isMock ? 'rejected' : 'present'
  });
  const status = isMock ? 'rejected' : metrics.status;
  const lateMinutes = isMock ? 0 : metrics.lateMinutes;

  return repo.createCheckIn({
    worker_id: workerId,
    user_id: req.user.id,
    company_id: companyId,
    project_id: projectId,
    work_location_id: workLocation.id,
    session_id: req.user.sessionId || null,
    device_source: 'mobile_app',
    attendance_date: dayContext.date,
    latitude: workLocation.latitude,
    longitude: workLocation.longitude,
    gps_accuracy: workLocation.accuracy,
    device_id: deviceId,
    ip_address: workLocation.ip_address,
    user_agent: req.headers['user-agent'],
    photo_url,
    is_mock_location: isMock,
    out_of_range: false,
    distance_meters: workLocation.distance_meters,
    allowed_radius_meters: workLocation.allowed_radius_meters,
    is_location_valid: true,
    location_validation_message: 'Ubicacion validada correctamente.',
    device_info: workLocation.device_info,
    assignment_source: workLocation.source,
    validation_status: 'valid',
    status,
    late_minutes: lateMinutes,
    shift_id: schedule.shift.id,
    labor_policy_id: schedule.policy.id,
    check_in_time: checkInTime,
    check_in_at: normalizedCheckIn.timestamp || checkInMoment.toDate().toISOString(),
    check_in_source_format: normalizedCheckIn.sourceFormat,
    timezone: dayContext.timezone,
    scheduled_check_in: metrics.scheduledCheckIn ? moment.tz(metrics.scheduledCheckIn, dayContext.timezone).format('HH:mm:ss') : null,
    scheduled_check_out: metrics.scheduledCheckOut ? moment.tz(metrics.scheduledCheckOut, dayContext.timezone).format('HH:mm:ss') : null,
    tolerance_minutes: metrics.toleranceMinutes,
    expected_minutes: metrics.expectedMinutes,
    break_minutes: metrics.breakMinutes,
    break_paid: metrics.breakPaid,
    calculation_details: metrics.calculationDetails,
    notes
  });
};

exports.checkOut = async (req) => {
  normalizeAttendanceRequestBody(req);
  const companyId = req.tenantId;
  const deviceId =
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    req.body?.device_identifier ||
    req.body?.device_id ||
    req.body?.deviceId ||
    null;

  const requestedWorkLocationId = normalizeWorkLocationId(req);
  const markNow = new Date();
  const initialAttendanceInput = normalizeRequestAttendanceInput(req, 'check_out', { now: markNow });
  const attendanceDate = initialAttendanceInput.normalized.date;
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId, attendanceDate);
  assertMobileAttendanceClient(req, validation);
  const workerId = validation.workerId;

  const existing = await repo.getTodayCheckIn(workerId, attendanceDate, companyId);
  if (!existing) {
    throw createHttpError(400, 'CHECK_IN_NOT_FOUND', 'No existe check-in para el dia de hoy');
  }
  if (existing.check_out_time) {
    throw createHttpError(409, 'CHECK_OUT_ALREADY_EXISTS', 'Ya se registro la salida para hoy');
  }

  const schedule = await scheduleService.resolveWorkerSchedule(workerId, companyId, attendanceDate);
  let dayContext;
  try {
    dayContext = assertScheduleAllowsAttendance(schedule, attendanceDate);
  } catch (error) {
    if (error?.errorCode === 'NON_WORKING_DAY') {
      logger.logWarn('ATTENDANCE', 'mobile.attendance.non_working_day', {
        workerId,
        shiftId: error.details?.shiftId || null,
        date: error.details?.date || attendanceDate,
        day: error.details?.day || null,
        timezone: error.details?.timezone || null,
        workingDays: error.details?.workingDays || []
      });
    }
    throw error;
  }

  const locationPayload = validateAttendanceLocationPayload(req);
  logger.logInfo('ATTENDANCE', 'mobile.attendance.checkout.request', {
    userId: req.user.id,
    workerId,
    companyId,
    date: dayContext.date,
    day: dayContext.day,
    timezone: dayContext.timezone,
    workLocationId: requestedWorkLocationId || null,
    hasPhoto: Boolean(req.file || getPhotoUrl(req.body || {})),
    accuracy: locationPayload.accuracy,
    isMockLocation: locationPayload.isMockLocation
  });

  const photo_url = req.file
    ? await uploadAttendancePhoto(req, companyId, 'checkout_')
    : (getPhotoUrl(req.body || {}) || existing.check_out_photo_url || existing.check_in_photo_url || existing.photo_url);

  const workLocation = await validateAssignedWorkLocation(
    req,
    workerId,
    'check_out',
    dayContext.date,
    requestedWorkLocationId,
    locationPayload
  );
  const start = buildAttendanceMoment({
    date: dayContext.date,
    time: existing.check_in_time,
    timezone: dayContext.timezone
  });
  const { rawAttendanceTime, normalized: normalizedCheckOut } = normalizeRequestAttendanceInput(req, 'check_out', {
    fallbackDate: dayContext.date,
    timezone: dayContext.timezone,
    now: markNow
  });
  const checkOutTime = normalizedCheckOut.time;
  const end = buildAttendanceMoment({
    date: dayContext.date,
    time: checkOutTime,
    timezone: dayContext.timezone
  });
  if (end.isBefore(start)) {
    end.add(1, 'day');
  }
  logger.logInfo('ATTENDANCE', 'Mobile attendance time normalized', {
    userId: req.user.id,
    workerId,
    rawAttendanceTime,
    normalizedDate: normalizedCheckOut.date,
    normalizedTime: normalizedCheckOut.time,
    sourceFormat: normalizedCheckOut.sourceFormat
  });
  const worked_minutes = end.diff(start, 'minutes');
  const worked_hours = (worked_minutes / 60).toFixed(2);
  const metrics = scheduleService.calculateAttendanceMetrics({
    schedule,
    checkInTime: start.toDate(),
    checkOutTime: end.toDate(),
    status: existing.status
  });

  return repo.updateCheckOut(existing.id, {
    latitude: workLocation.latitude,
    longitude: workLocation.longitude,
    gps_accuracy: workLocation.accuracy,
    device_id: deviceId,
    session_id: req.user.sessionId || null,
    device_source: 'mobile_app',
    ip_address: workLocation.ip_address,
    user_agent: req.headers['user-agent'],
    photo_url,
    is_mock_location: locationPayload.isMockLocation,
    out_of_range: false,
    distance_meters: workLocation.distance_meters,
    allowed_radius_meters: workLocation.allowed_radius_meters,
    is_location_valid: true,
    location_validation_message: 'Ubicacion validada correctamente.',
    device_info: workLocation.device_info,
    assignment_source: workLocation.source,
    validation_status: 'valid',
    worked_minutes,
    worked_hours,
    effective_worked_minutes: metrics.effectiveWorkedMinutes,
    overtime_minutes: metrics.overtimeMinutes,
    early_leave_minutes: metrics.earlyLeaveMinutes,
    late_minutes: metrics.lateMinutes,
    status: metrics.status,
    check_out_time: checkOutTime,
    check_out_at: normalizedCheckOut.timestamp || end.toDate().toISOString(),
    check_out_source_format: normalizedCheckOut.sourceFormat,
    date: dayContext.date,
    timezone: dayContext.timezone,
    scheduled_check_in: metrics.scheduledCheckIn ? moment.tz(metrics.scheduledCheckIn, dayContext.timezone).format('HH:mm:ss') : null,
    scheduled_check_out: metrics.scheduledCheckOut ? moment.tz(metrics.scheduledCheckOut, dayContext.timezone).format('HH:mm:ss') : null,
    tolerance_minutes: metrics.toleranceMinutes,
    expected_minutes: metrics.expectedMinutes,
    break_minutes: metrics.breakMinutes,
    break_paid: metrics.breakPaid,
    calculation_details: metrics.calculationDetails
  });
};

exports.applyManualCorrection = async ({ workerId, companyId, date, checkInTime, checkOutTime, status, reason, adminUserId }) => {
  const schedule = await scheduleService.resolveWorkerSchedule(workerId, companyId, date);
  const timezone = schedule?.shift?.timezone || schedule?.policy?.timezone || 'America/Lima';

  const checkInMoment = checkInTime ? moment.tz(checkInTime, timezone) : null;
  const checkOutMoment = checkOutTime ? moment.tz(checkOutTime, timezone) : null;

  const metrics = scheduleService.calculateAttendanceMetrics({
    schedule,
    checkInTime: checkInMoment ? checkInMoment.toDate() : null,
    checkOutTime: checkOutMoment ? checkOutMoment.toDate() : null,
    status: status || 'present'
  });

  let worked_minutes = null;
  let worked_hours = null;

  if (checkInMoment && checkOutMoment) {
    let start = checkInMoment.clone();
    let end = checkOutMoment.clone();
    if (end.isBefore(start)) {
      end.add(1, 'day'); // Crosses midnight
    }
    worked_minutes = end.diff(start, 'minutes');
    worked_hours = (worked_minutes / 60).toFixed(2);
  }

  const upsertData = {
    worker_id: workerId,
    company_id: companyId,
    date: date,
    status: metrics.status,
    check_in_time: checkInMoment ? checkInMoment.format('HH:mm:ss') : null,
    check_out_time: checkOutMoment ? checkOutMoment.format('HH:mm:ss') : null,
    check_in_at: checkInMoment ? checkInMoment.toDate().toISOString() : null,
    check_out_at: checkOutMoment ? checkOutMoment.toDate().toISOString() : null,
    late_minutes: metrics.lateMinutes || 0,
    expected_minutes: metrics.expectedMinutes || 0,
    worked_minutes: worked_minutes,
    worked_hours: worked_hours,
    hours_worked: worked_hours,
    effective_worked_minutes: metrics.effectiveWorkedMinutes,
    break_minutes: metrics.breakMinutes || 0,
    break_paid: metrics.breakPaid || false,
    overtime_minutes: metrics.overtimeMinutes || 0,
    early_leave_minutes: metrics.earlyLeaveMinutes || 0,
    shift_id: schedule?.shift?.id || null,
    scheduled_check_in: metrics.scheduledCheckIn ? moment.tz(metrics.scheduledCheckIn, timezone).format('HH:mm:ss') : null,
    scheduled_check_out: metrics.scheduledCheckOut ? moment.tz(metrics.scheduledCheckOut, timezone).format('HH:mm:ss') : null,
    tolerance_minutes: metrics.toleranceMinutes || 0
  };

  const record = await repo.upsertManualCorrection(upsertData);

  // Todo: Log the reason in an audit table or `attendance_corrections` if needed.
  if (reason) {
    logger.logInfo('ATTENDANCE', 'manual_correction_applied', {
      attendanceId: record.id,
      workerId,
      adminUserId,
      reason,
      oldCheckIn: record.check_in_time,
      newCheckIn: checkInTime
    });
  }

  return record;
};
