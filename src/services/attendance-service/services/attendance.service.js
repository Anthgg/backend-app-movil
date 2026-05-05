const repo = require('../repositories/attendance.repository');
const { validateAttendanceDeviceAndTenant } = require('../../../shared/utils/validators');
const geo = require('../../../shared/utils/geolocation.utils');
const storage = require('../../../shared/utils/storage.utils');
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

  const { latitude, longitude, gps_accuracy, is_mock_location, notes } = req.body || {};
  let { photo_url } = req.body || {};

  // Resolver fecha de asistencia (body > hoy)
  const attendanceDate =
    req.body?.date ||
    req.body?.attendance_date ||
    moment().format('YYYY-MM-DD');

  // 3. Validar Usuario, Trabajador y Device
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId, attendanceDate);
  const workerId = validation.workerId;

  // 4. No doble checkin
  const existing = await repo.getTodayCheckIn(workerId, attendanceDate);
  if (existing) {
    const err = new Error('Ya existe una asistencia registrada hoy para este trabajador');
    err.statusCode = 409;
    err.errorCode = 'ATTENDANCE_ALREADY_EXISTS';
    throw err;
  }

  // 5. Manejo de Foto (Multipart)
  if (req.file) {
    const timestamp = Date.now();
    const extension = req.file.mimetype.split('/')[1] || 'jpg';
    const filePath = `attendance/${companyId}/${req.user.id}/${moment().format('YYYY/MM/DD')}/${timestamp}.${extension}`;
    
    try {
      photo_url = await storage.uploadFile(req.file, 'attendance-photos', filePath);
    } catch (uploadErr) {
      console.error('Error uploading attendance photo:', uploadErr);
      // Opcional: Fallar si la foto es obligatoria
    }
  }

  // 6. Geolocalización
  const project = await repo.getProject(projectId, companyId);
  if (!project) {
    const err = new Error(`Proyecto no encontrado o no pertenece a su empresa.`);
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
    status, late_minutes: 0, notes
  });
};

exports.checkOut = async (req) => {
  const companyId = req.tenantId;

  // 2. Extraer identificador de dispositivo
  const deviceId =
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    req.body?.device_identifier ||
    req.body?.device_id ||
    req.body?.deviceId;

  const { latitude, longitude, gps_accuracy, is_mock_location } = req.body || {};
  let { photo_url } = req.body || {};
  const attendanceDate = req.body?.date || req.body?.attendance_date || moment().format('YYYY-MM-DD');

  // 3. Validar Usuario, Trabajador y Device
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, companyId, deviceId, attendanceDate);
  const workerId = validation.workerId;

  const today = moment().format('YYYY-MM-DD');
  const existing = await repo.getTodayCheckIn(workerId, today);
  if (!existing) {
    const err = new Error('No existe check-in para el día de hoy');
    err.statusCode = 400;
    err.errorCode = 'CHECK_IN_NOT_FOUND';
    throw err;
  }
  if (existing.check_out_time) {
    const err = new Error('Ya se registró la salida para hoy');
    err.statusCode = 409;
    err.errorCode = 'CHECK_OUT_ALREADY_EXISTS';
    throw err;
  }

  // Manejo de Foto opcional en salida
  if (req.file) {
    const timestamp = Date.now();
    const extension = req.file.mimetype.split('/')[1] || 'jpg';
    const filePath = `attendance/${companyId}/${req.user.id}/${moment().format('YYYY/MM/DD')}/checkout_${timestamp}.${extension}`;
    photo_url = await storage.uploadFile(req.file, 'attendance-photos', filePath);
  }

  const project = await repo.getProject(existing.project_id, companyId);
  const { isWithin, distance } = geo.isWithinAllowedRadius(latitude, longitude, project.latitude, project.longitude, project.allowed_radius_meters || 100);

  const start = moment(existing.check_in_time);
  const end = moment();
  const worked_minutes = end.diff(start, 'minutes');
  const worked_hours = (worked_minutes / 60).toFixed(2);

  return await repo.updateCheckOut(existing.id, {
    latitude, longitude, gps_accuracy, device_id: deviceId, ip_address: req.ip, user_agent: req.headers['user-agent'],
    photo_url: photo_url || existing.photo_url, 
    is_mock_location: geo.detectMockLocation(is_mock_location), out_of_range: !isWithin, distance_meters: distance,
    worked_minutes, worked_hours, overtime_minutes: 0, status: existing.status
  });
};
