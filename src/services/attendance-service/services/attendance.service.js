const repo = require('../repositories/attendance.repository');
const { validateAttendanceDeviceAndTenant } = require('../../../shared/utils/validators');
const geo = require('../../../shared/utils/geolocation.utils');
const moment = require('moment');

exports.checkIn = async (req) => {
  // 1. Extraer project_id con fallback robusto (body > header > query)
  const projectId =
    req.body?.project_id ||
    req.body?.projectId ||
    req.headers['x-project-id'] ||
    req.query?.project_id ||
    req.query?.projectId;

  const companyId = req.tenantId;

  // LOG TEMPORAL OBLIGATORIO
  console.log('ATTENDANCE PROJECT DEBUG', {
    body: req.body,
    query: req.query,
    headerProjectId: req.headers['x-project-id'],
    resolvedProjectId: projectId,
    companyId
  });

  if (!projectId) {
    const err = new Error('ID de proyecto no recibido en la petición.');
    err.statusCode = 400;
    err.errorCode = 'PROJECT_ID_REQUIRED';
    throw err;
  }

  // 2. Extraer identificador de dispositivo (Headers > Body)
  const deviceId =
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    req.body?.device_identifier ||
    req.body?.device_id ||
    req.body?.deviceId;

  const { latitude, longitude, gps_accuracy, is_mock_location, photo_url, notes } = req.body || {};

  // Resolver fecha de asistencia (body > hoy)
  const attendanceDate =
    req.body?.date ||
    req.body?.attendance_date ||
    moment().format('YYYY-MM-DD');

  // 3. Validar Usuario, Trabajador y Device
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId);
  const workerId = validation.workerId;

  // 4. No doble checkin
  const existing = await repo.getTodayCheckIn(workerId, attendanceDate);
  if (existing) throw new Error('Ya existe una asistencia registrada hoy para este trabajador');

  // 5. Geolocalización — usar projectId (la variable local, no req.projectId)
  const project = await repo.getProject(projectId, companyId);
  if (!project) {
    const err = new Error(`Proyecto no encontrado o no pertenece a su empresa. (ID: ${projectId}, Company: ${companyId})`);
    err.statusCode = 404;
    err.errorCode = 'PROJECT_NOT_FOUND';
    throw err;
  }

  const { isWithin, distance } = geo.isWithinAllowedRadius(latitude, longitude, project.latitude, project.longitude, project.allowed_radius_meters || 100);
  const isMock = geo.detectMockLocation(is_mock_location);

  let status = 'present';
  if (isMock) status = 'rejected';
  else if (!isWithin) status = 'out_of_range';

  // Registrar en DB
  return await repo.createCheckIn({
    worker_id: workerId, user_id: req.user.id, company_id: companyId, project_id: projectId,
    attendance_date: attendanceDate,
    latitude, longitude, gps_accuracy, device_id: deviceId, ip_address: req.ip, user_agent: req.headers['user-agent'],
    photo_url, is_mock_location: isMock, out_of_range: !isWithin, distance_meters: distance,
    status, late_minutes: 0 // Simplificado
  });
};

exports.checkOut = async (req) => {
  // 1. Extraer project_id con fallback robusto
  const projectId =
    req.body?.project_id ||
    req.body?.projectId ||
    req.headers['x-project-id'] ||
    req.query?.project_id ||
    req.query?.projectId;

  const companyId = req.tenantId;

  // 2. Extraer identificador de dispositivo (Headers > Body)
  const deviceId =
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    req.body?.device_identifier ||
    req.body?.device_id ||
    req.body?.deviceId;

  const { latitude, longitude, gps_accuracy, is_mock_location, photo_url } = req.body || {};

  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId);
  const workerId = validation.workerId;

  const today = moment().format('YYYY-MM-DD');
  const existing = await repo.getTodayCheckIn(workerId, today);
  if (!existing) throw new Error('No existe check-in para el día de hoy');
  if (existing.check_out_time) throw new Error('Ya se registró la salida para hoy');

  const project = await repo.getProject(existing.project_id, companyId);
  const { isWithin, distance } = geo.isWithinAllowedRadius(latitude, longitude, project.latitude, project.longitude, project.allowed_radius_meters || 100);

  const start = moment(existing.check_in_time);
  const end = moment();
  const worked_minutes = end.diff(start, 'minutes');
  const worked_hours = (worked_minutes / 60).toFixed(2);

  return await repo.updateCheckOut(existing.id, {
    latitude, longitude, gps_accuracy, device_id: deviceId, ip_address: req.ip, user_agent: req.headers['user-agent'],
    photo_url, is_mock_location: geo.detectMockLocation(is_mock_location), out_of_range: !isWithin, distance_meters: distance,
    worked_minutes, worked_hours, overtime_minutes: 0, status: existing.status
  });
};
