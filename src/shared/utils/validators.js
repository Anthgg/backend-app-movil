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
  if (!user) {
    const err = new Error('USER_NOT_FOUND');
    err.statusCode = 404;
    err.errorCode = 'USER_NOT_FOUND';
    throw err;
  }
  if (!user.user_active || user.user_status !== 'active') {
    const err = new Error('USER_DISABLED');
    err.statusCode = 403;
    err.errorCode = 'USER_DISABLED';
    throw err;
  }
  if (user.company_id !== companyId) {
    const err = new Error('COMPANY_MISMATCH');
    err.statusCode = 403;
    err.errorCode = 'COMPANY_MISMATCH';
    throw err;
  }
  
  if (!user.worker_id) {
    const err = new Error('WORKER_NOT_FOUND');
    err.statusCode = 404;
    err.errorCode = 'WORKER_NOT_FOUND';
    throw err;
  }
  if (!user.worker_active || user.employment_status !== 'active') {
    const err = new Error('WORKER_DISABLED');
    err.statusCode = 403;
    err.errorCode = 'WORKER_DISABLED';
    throw err;
  }

  // Validar Dispositivo
  const deviceRes = await query(`
    SELECT is_blocked, is_authorized 
    FROM user_devices 
    WHERE device_id = $1 AND user_id = $2
  `, [deviceId, userId]);

  const device = deviceRes.rows[0];
  if (!device) {
    const err = new Error('DEVICE_NOT_REGISTERED');
    err.statusCode = 403;
    err.errorCode = 'DEVICE_NOT_REGISTERED';
    throw err;
  }
  if (device.is_blocked) {
    const err = new Error('DEVICE_BLOCKED');
    err.statusCode = 403;
    err.errorCode = 'DEVICE_BLOCKED';
    throw err;
  }
  // if (!device.is_authorized) throw new Error('DEVICE_UNAUTHORIZED'); // Depende de la politica de la empresa

  return { workerId: user.worker_id, isValid: true };
};

module.exports = { validateAttendanceDeviceAndTenant };
