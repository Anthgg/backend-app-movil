const { query } = require('../../config/database');

const validateAttendanceDeviceAndTenant = async (userId, companyId, deviceId) => {
  // Validar Usuario y Trabajador
  const userRes = await query(`
    SELECT u.is_active as user_active, u.status as user_status, u.company_id, w.id as worker_id, w.is_active as worker_active, w.employment_status
    FROM users u
    LEFT JOIN workers w ON u.id = w.user_id AND w.deleted_at IS NULL
    WHERE u.id = $1 AND u.deleted_at IS NULL
  `, [userId]);

  const user = userRes.rows[0];
  if (!user) throw new Error('USER_NOT_FOUND');
  if (!user.user_active || user.user_status !== 'active') throw new Error('USER_DISABLED');
  if (user.company_id !== companyId) throw new Error('COMPANY_MISMATCH');
  
  if (!user.worker_id) throw new Error('WORKER_NOT_FOUND');
  if (!user.worker_active || user.employment_status !== 'active') throw new Error('WORKER_DISABLED');

  // Validar Dispositivo
  const deviceRes = await query(`
    SELECT is_blocked, is_authorized 
    FROM user_devices 
    WHERE device_id = $1 AND user_id = $2
  `, [deviceId, userId]);

  const device = deviceRes.rows[0];
  if (!device) throw new Error('DEVICE_NOT_REGISTERED');
  if (device.is_blocked) throw new Error('DEVICE_BLOCKED');
  // if (!device.is_authorized) throw new Error('DEVICE_UNAUTHORIZED'); // Depende de la politica de la empresa

  return { workerId: user.worker_id, isValid: true };
};

module.exports = { validateAttendanceDeviceAndTenant };
