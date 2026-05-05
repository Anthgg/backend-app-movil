const { query } = require('../../config/database');

const validateAttendanceDeviceAndTenant = async (userId, companyId, deviceId, attendanceDate = null) => {
  const targetDate = attendanceDate || new Date().toISOString().split('T')[0];

  // Validar Usuario y Trabajador
  const userRes = await query(`
    SELECT u.is_active as user_active, u.status as user_status, u.company_id, 
           w.id as worker_id, w.is_active as worker_active, w.employment_status, w.hire_date
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

  // Validación de fecha de ingreso
  if (user.hire_date && new Date(targetDate) < new Date(user.hire_date)) {
    const err = new Error('ATTENDANCE_BEFORE_HIRE_DATE');
    err.statusCode = 403;
    err.errorCode = 'ATTENDANCE_BEFORE_HIRE_DATE';
    err.message = `No puedes registrar asistencia antes de tu fecha de ingreso (${user.hire_date})`;
    throw err;
  }

  if (!user.worker_active || user.employment_status !== 'active') {
    const err = new Error('WORKER_DISABLED');
    err.statusCode = 403;
    err.errorCode = 'WORKER_DISABLED';
    throw err;
  }

  // Validación de contrato (opcional pero recomendada)
  const contractRes = await query(`
    SELECT start_date, end_date FROM worker_contracts 
    WHERE worker_id = $1 AND status = 'active'
    AND start_date <= $2
    ORDER BY start_date DESC LIMIT 1
  `, [user.worker_id, targetDate]);

  if (contractRes.rows.length > 0) {
    const contract = contractRes.rows[0];
    if (contract.end_date && new Date(targetDate) > new Date(contract.end_date)) {
        const err = new Error('CONTRACT_EXPIRED');
        err.statusCode = 403;
        err.errorCode = 'CONTRACT_EXPIRED';
        err.message = `No puedes registrar asistencia después del fin de tu contrato (${contract.end_date})`;
        throw err;
    }
  }

  // Validar Dispositivo
  const deviceRes = await query(`
    SELECT id, user_id, company_id, device_id, device_identifier,
           is_authorized, is_blocked, is_trusted
    FROM public.user_devices
    WHERE user_id = $1::uuid
      AND ($2::uuid IS NULL OR company_id = $2::uuid)
      AND (
        device_identifier::text = $3::text
        OR device_id::text = $3::text
        OR id::text = $3::text
      )
    LIMIT 1
  `, [userId, companyId, deviceId]);

  const device = deviceRes.rows[0];

  if (!device) {
    // Loguear para depuración (Regla 6)
    const existingDevicesRes = await query(
      'SELECT id, device_id, device_identifier, is_authorized, is_blocked FROM user_devices WHERE user_id = $1::uuid',
      [userId]
    );
    
    console.log('[DEBUG] DEVICE_NOT_REGISTERED Detail:', {
      userId,
      companyId,
      deviceReceived: deviceId,
      existingDevicesForUser: existingDevicesRes.rows
    });

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

  if (!device.is_authorized) {
    const err = new Error('DEVICE_UNAUTHORIZED');
    err.statusCode = 403;
    err.errorCode = 'DEVICE_UNAUTHORIZED';
    throw err;
  }

  return { workerId: user.worker_id, isValid: true };
};

module.exports = { validateAttendanceDeviceAndTenant };
