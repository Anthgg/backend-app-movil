const { query } = require('../../config/database');

function buildError(message, statusCode, errorCode, details = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.errorCode = errorCode;
  if (Object.keys(details).length > 0) {
    err.details = details;
  }
  return err;
}

const validateAttendanceDeviceAndTenant = async (userId, companyId, deviceId, attendanceDate = null) => {
  const targetDate = attendanceDate || new Date().toISOString().split('T')[0];

  const userRes = await query(`
    SELECT u.is_active as user_active, u.status as user_status, u.company_id,
           w.id as worker_id, w.is_active as worker_active, w.employment_status, w.hire_date
    FROM users u
    LEFT JOIN workers w ON u.id = w.user_id AND w.deleted_at IS NULL
    WHERE u.id = $1 AND u.deleted_at IS NULL
  `, [userId]);

  const user = userRes.rows[0];
  if (!user) {
    throw buildError('USER_NOT_FOUND', 404, 'USER_NOT_FOUND');
  }
  if (!user.user_active || user.user_status !== 'active') {
    throw buildError('USER_DISABLED', 403, 'USER_DISABLED');
  }
  if (user.company_id !== companyId) {
    throw buildError('El trabajador no pertenece a la empresa del usuario autenticado.', 403, 'WORKER_COMPANY_MISMATCH', {
      userCompanyId: user.company_id,
      companyId
    });
  }
  if (!user.worker_id) {
    throw buildError('WORKER_NOT_FOUND', 404, 'WORKER_NOT_FOUND');
  }

  if (user.hire_date && new Date(targetDate) < new Date(user.hire_date)) {
    throw buildError(
      `No puedes registrar asistencia antes de tu fecha de ingreso (${user.hire_date})`,
      403,
      'ATTENDANCE_BEFORE_HIRE_DATE'
    );
  }

  if (!user.worker_active || user.employment_status !== 'active') {
    throw buildError('El trabajador autenticado no esta activo.', 422, 'WORKER_NOT_ACTIVE', {
      workerId: user.worker_id,
      workerStatus: user.employment_status || null,
      isActive: user.worker_active === true
    });
  }

  const contractRes = await query(`
    SELECT start_date, end_date
    FROM worker_contracts
    WHERE worker_id = $1
      AND status = 'active'
      AND start_date <= $2
    ORDER BY start_date DESC
    LIMIT 1
  `, [user.worker_id, targetDate]);

  if (contractRes.rows.length > 0) {
    const contract = contractRes.rows[0];
    if (contract.end_date && new Date(targetDate) > new Date(contract.end_date)) {
      throw buildError(
        `No puedes registrar asistencia despues del fin de tu contrato (${contract.end_date})`,
        403,
        'CONTRACT_EXPIRED'
      );
    }
  }

  let device = null;

  if (deviceId) {
    const deviceRes = await query(`
      SELECT id, user_id, company_id, device_id, device_identifier, platform,
             is_authorized, is_blocked, is_trusted
      FROM public.user_devices
      WHERE user_id = $1::uuid
        AND ($2::uuid IS NULL OR company_id = $2::uuid OR company_id IS NULL)
        AND (
          device_identifier::text = $3::text
          OR device_id::text = $3::text
          OR id::text = $3::text
        )
      LIMIT 1
    `, [userId, companyId, deviceId]);

    device = deviceRes.rows[0] || null;

    if (!device) {
      console.log('[ATTENDANCE_DEVICE_CONTEXT_MISSING]', {
        userId,
        companyId,
        deviceReceived: deviceId
      });
    }

    if (device?.is_blocked) {
      throw buildError('DEVICE_BLOCKED', 403, 'DEVICE_BLOCKED');
    }

    if (device && device.is_authorized === false) {
      throw buildError('DEVICE_UNAUTHORIZED', 403, 'DEVICE_UNAUTHORIZED');
    }
  }

  return {
    workerId: user.worker_id,
    device,
    deviceContextRequired: false,
    isValid: true
  };
};

module.exports = { validateAttendanceDeviceAndTenant };
