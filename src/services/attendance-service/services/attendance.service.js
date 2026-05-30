const repo = require('../repositories/attendance.repository');
const env = require('../../../config/env');
const { validateAttendanceDeviceAndTenant } = require('../../../shared/utils/validators');
const geo = require('../../../shared/utils/geolocation.utils');
const storage = require('../../../shared/utils/storage.utils');
const moment = require('moment-timezone');
const { getWorkerShift, TIMEZONE } = require('./mobile-attendance.service');

function createHttpError(statusCode, errorCode, message, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.errorCode = errorCode;
  if (Object.keys(extra).length > 0) err.details = extra;
  Object.assign(err, extra);
  return err;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getAccuracy(body = {}) {
  return normalizeNumber(body.accuracy ?? body.gps_accuracy);
}

function getDeviceInfo(req) {
  return req.body?.device_info || {
    platform: req.body?.platform || null,
    userAgent: req.headers['user-agent'] || null
  };
}

async function validateAssignedWorkLocation(req, workerId, type) {
  const latitude = normalizeNumber(req.body?.latitude);
  const longitude = normalizeNumber(req.body?.longitude);
  const accuracy = getAccuracy(req.body || {});
  const companyId = req.tenantId;
  const location = await repo.getWorkerWorkLocation(workerId, companyId);
  const deviceInfo = getDeviceInfo(req);

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
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
    ...payload
  });

  if (!location?.work_location_id) {
    const message = 'El trabajador no tiene un lugar de trabajo asignado para realizar marcaciones.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_REQUIRED', message);
  }

  if (!location.name) {
    const message = 'El lugar de trabajo asignado no existe.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_NOT_FOUND', message);
  }

  if (!location.is_active) {
    const message = 'El lugar de trabajo asignado no está activo.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_INACTIVE', message);
  }

  if (location.latitude === null || location.longitude === null) {
    const message = 'El lugar de trabajo asignado no tiene coordenadas configuradas.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'WORK_LOCATION_COORDINATES_REQUIRED', message);
  }

  if (!geo.validateCoordinates(latitude, longitude)) {
    const message = 'Debe enviar coordenadas válidas para registrar asistencia.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'INVALID_COORDINATES', message);
  }

  if (!geo.validateGpsAccuracy(accuracy, 100)) {
    const message = 'La precisión GPS es insuficiente para registrar asistencia.';
    await logAttempt({ is_location_valid: false, validation_message: message });
    throw createHttpError(422, 'GPS_ACCURACY_TOO_LOW', message);
  }

  const allowedRadius = Number(location.allowed_radius_meters || 100);
  const { isWithin, distance } = geo.isWithinAllowedRadius(
    latitude,
    longitude,
    location.latitude,
    location.longitude,
    allowedRadius
  );

  if (!isWithin) {
    const message = 'No se puede registrar la marcación porque se encuentra fuera del radio permitido.';
    await logAttempt({
      distance_meters: distance,
      allowed_radius_meters: allowedRadius,
      is_location_valid: false,
      validation_message: message
    });
    throw createHttpError(403, 'OUT_OF_WORK_LOCATION_RADIUS', message, {
      distance_meters: distance,
      allowed_radius_meters: allowedRadius,
      work_location: location.name
    });
  }

  await logAttempt({
    distance_meters: distance,
    allowed_radius_meters: allowedRadius,
    is_location_valid: true,
    validation_message: 'Ubicación validada correctamente.'
  });

  return {
    id: location.work_location_id,
    name: location.name,
    latitude,
    longitude,
    accuracy,
    allowed_radius_meters: allowedRadius,
    distance_meters: distance,
    device_info: deviceInfo
  };
}

async function uploadAttendancePhoto(req, companyId, prefix = '') {
  if (!req.file) return req.body?.photo_url || null;

  const timestamp = Date.now();
  const extension = req.file.mimetype.split('/')[1] || 'jpg';
  const filePath = `attendance/${companyId}/${req.user.id}/${moment().format('YYYY/MM/DD')}/${prefix}${timestamp}.${extension}`;
  return storage.uploadFile(req.file, env.attendancePhotosBucket, filePath);
}

exports.checkIn = async (req) => {
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
    req.body?.deviceId;

  const { latitude, longitude, is_mock_location, notes } = req.body || {};
  const gps_accuracy = getAccuracy(req.body || {});
  const attendanceDate = req.body?.date || req.body?.attendance_date || moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId, attendanceDate);
  const workerId = validation.workerId;

  const existing = await repo.getTodayCheckIn(workerId, attendanceDate);
  if (existing) {
    throw createHttpError(409, 'ATTENDANCE_ALREADY_EXISTS', 'Ya existe una asistencia registrada hoy para este trabajador');
  }

  let photo_url = req.body?.photo_url || null;
  if (req.file) {
    try {
      photo_url = await uploadAttendancePhoto(req, companyId);
    } catch (uploadErr) {
      console.error('Error uploading attendance photo:', uploadErr);
    }
  }

  const workLocation = await validateAssignedWorkLocation(req, workerId, 'check_in');
  const isMock = geo.detectMockLocation(is_mock_location);

  let status = isMock ? 'rejected' : 'present';
  const shift = await getWorkerShift(workerId, companyId);
  let lateMinutes = 0;

  if (!isMock && shift?.startTime) {
    const now = moment().tz(TIMEZONE);
    const scheduledStart = moment.tz(`${attendanceDate} ${shift.startTime}`, 'YYYY-MM-DD HH:mm', TIMEZONE);
    const toleranceLimit = scheduledStart.clone().add(shift.toleranceMinutes || 0, 'minutes');

    if (now.isAfter(toleranceLimit)) {
      status = 'late';
      lateMinutes = Math.max(now.diff(scheduledStart, 'minutes'), 0);
    }
  }

  return repo.createCheckIn({
    worker_id: workerId,
    user_id: req.user.id,
    company_id: companyId,
    project_id: projectId,
    work_location_id: workLocation.id,
    attendance_date: attendanceDate,
    latitude,
    longitude,
    gps_accuracy,
    device_id: deviceId,
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
    photo_url,
    is_mock_location: isMock,
    out_of_range: false,
    distance_meters: workLocation.distance_meters,
    allowed_radius_meters: workLocation.allowed_radius_meters,
    is_location_valid: true,
    location_validation_message: 'Ubicación validada correctamente.',
    device_info: workLocation.device_info,
    status,
    late_minutes: lateMinutes,
    shift_id: shift?.id || null,
    notes
  });
};

exports.checkOut = async (req) => {
  const companyId = req.tenantId;
  const deviceId =
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    req.body?.device_identifier ||
    req.body?.device_id ||
    req.body?.deviceId;

  const { latitude, longitude, is_mock_location } = req.body || {};
  const gps_accuracy = getAccuracy(req.body || {});
  const attendanceDate = req.body?.date || req.body?.attendance_date || moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId, attendanceDate);
  const workerId = validation.workerId;

  const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const existing = await repo.getTodayCheckIn(workerId, today);
  if (!existing) {
    throw createHttpError(400, 'CHECK_IN_NOT_FOUND', 'No existe check-in para el día de hoy');
  }
  if (existing.check_out_time) {
    throw createHttpError(409, 'CHECK_OUT_ALREADY_EXISTS', 'Ya se registró la salida para hoy');
  }

  const photo_url = req.file
    ? await uploadAttendancePhoto(req, companyId, 'checkout_')
    : (req.body?.photo_url || existing.photo_url);

  const workLocation = await validateAssignedWorkLocation(req, workerId, 'check_out');
  const start = moment(existing.check_in_time).tz(TIMEZONE);
  const end = moment().tz(TIMEZONE);
  const worked_minutes = end.diff(start, 'minutes');
  const worked_hours = (worked_minutes / 60).toFixed(2);
  const shift = existing.shift_id ? await getWorkerShift(workerId, companyId) : null;
  let overtime_minutes = 0;

  if (shift?.endTime) {
    let scheduledEnd = moment.tz(`${attendanceDate} ${shift.endTime}`, 'YYYY-MM-DD HH:mm', TIMEZONE);
    const scheduledStart = shift.startTime ? moment.tz(`${attendanceDate} ${shift.startTime}`, 'YYYY-MM-DD HH:mm', TIMEZONE) : null;
    if (scheduledStart && scheduledEnd.isSameOrBefore(scheduledStart)) {
      scheduledEnd.add(1, 'day');
    }
    overtime_minutes = Math.max(end.diff(scheduledEnd, 'minutes'), 0);
  }

  return repo.updateCheckOut(existing.id, {
    latitude,
    longitude,
    gps_accuracy,
    device_id: deviceId,
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
    photo_url,
    is_mock_location: geo.detectMockLocation(is_mock_location),
    out_of_range: false,
    distance_meters: workLocation.distance_meters,
    allowed_radius_meters: workLocation.allowed_radius_meters,
    is_location_valid: true,
    location_validation_message: 'Ubicación validada correctamente.',
    device_info: workLocation.device_info,
    worked_minutes,
    worked_hours,
    overtime_minutes,
    status: existing.status
  });
};
