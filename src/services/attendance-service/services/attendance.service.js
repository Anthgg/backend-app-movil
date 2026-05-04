const repo = require('../repositories/attendance.repository');
const { validateAttendanceDeviceAndTenant } = require('../../../shared/utils/validators');
const geo = require('../../../shared/utils/geolocation.utils');
const moment = require('moment');

exports.checkIn = async (req) => {
  // 1. Extraer identificador de dispositivo (Headers > Body)
  const device_id = 
    req.headers['x-device-id'] || 
    req.headers['x-device-identifier'] || 
    req.body.device_identifier || 
    req.body.device_id || 
    req.body.deviceId;

  const { latitude, longitude, gps_accuracy, is_mock_location, photo_url, project_id, notes } = req.body;
  
  // 2. Validar Usuario, Trabajador y Device
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, req.tenantId, device_id);
  const workerId = validation.workerId;

  // 2. No doble checkin
  const today = moment().format('YYYY-MM-DD');
  const existing = await repo.getTodayCheckIn(workerId, today);
  if (existing) throw new Error('Ya existe una asistencia registrada hoy para este trabajador');

  // 3. Geolocalización
  const project = await repo.getProject(project_id, req.tenantId);
  if (!project) throw new Error('Proyecto no encontrado');

  const { isWithin, distance } = geo.isWithinAllowedRadius(latitude, longitude, project.latitude, project.longitude, project.radius || 100);
  const isMock = geo.detectMockLocation(is_mock_location);

  let status = 'present';
  if (isMock) status = 'rejected';
  else if (!isWithin) status = 'out_of_range';

  // Registrar en DB
  return await repo.createCheckIn({
    worker_id: workerId, user_id: req.user.id, company_id: req.tenantId, project_id, 
    latitude, longitude, gps_accuracy, device_id, ip_address: req.ip, user_agent: req.headers['user-agent'],
    photo_url, is_mock_location: isMock, out_of_range: !isWithin, distance_meters: distance,
    status, late_minutes: 0 // Simplificado
  });
};

exports.checkOut = async (req) => {
  // 1. Extraer identificador de dispositivo (Headers > Body)
  const device_id = 
    req.headers['x-device-id'] || 
    req.headers['x-device-identifier'] || 
    req.body.device_identifier || 
    req.body.device_id || 
    req.body.deviceId;

  const { latitude, longitude, gps_accuracy, is_mock_location, photo_url } = req.body;
  
  const validation = await validateAttendanceDeviceAndTenant(req.user.id, req.tenantId, device_id);
  const workerId = validation.workerId;

  const today = moment().format('YYYY-MM-DD');
  const existing = await repo.getTodayCheckIn(workerId, today);
  if (!existing) throw new Error('No existe check-in para el día de hoy');
  if (existing.check_out_time) throw new Error('Ya se registró la salida para hoy');

  const project = await repo.getProject(existing.project_id, req.tenantId);
  const { isWithin, distance } = geo.isWithinAllowedRadius(latitude, longitude, project.latitude, project.longitude, project.radius || 100);
  
  const start = moment(existing.check_in_time);
  const end = moment();
  const worked_minutes = end.diff(start, 'minutes');
  const worked_hours = (worked_minutes / 60).toFixed(2);

  return await repo.updateCheckOut(existing.id, {
    latitude, longitude, gps_accuracy, device_id, ip_address: req.ip, user_agent: req.headers['user-agent'],
    photo_url, is_mock_location: geo.detectMockLocation(is_mock_location), out_of_range: !isWithin, distance_meters: distance,
    worked_minutes, worked_hours, overtime_minutes: 0, status: existing.status
  });
};
