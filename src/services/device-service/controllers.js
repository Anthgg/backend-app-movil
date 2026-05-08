const { query } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const logger = require('../../shared/utils/logger');

const MONTHLY_DEVICE_CHANGE_LIMIT = 3;

function getDeviceIdentifier(req) {
  return (
    req.body?.deviceId ||
    req.body?.device_id ||
    req.body?.deviceIdentifier ||
    req.body?.device_identifier ||
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    null
  );
}

async function countDeviceChangesThisMonth(userId) {
  const result = await query(
    `SELECT COUNT(*) AS count
     FROM public.device_change_logs
     WHERE user_id = $1
       AND month_key = TO_CHAR(NOW(), 'YYYY-MM')
       AND action IN ('CHANGE_DEVICE', 'REVOKE_CURRENT_DEVICE')`,
    [userId]
  );

  return parseInt(result.rows[0]?.count || 0, 10);
}

async function insertDeviceChangeLog({ userId, deviceId, action, req }) {
  await query(
    `INSERT INTO public.device_change_logs (user_id, device_id, action, month_key, ip_address, user_agent)
     VALUES ($1, $2, $3, TO_CHAR(NOW(), 'YYYY-MM'), $4, $5)`,
    [userId, deviceId, action, req.ip || null, req.headers['user-agent'] || null]
  );
}

exports.registerDevice = async (req, res, next) => {
  const userId = req.user?.id;
  const companyId = req.tenantId || req.user?.company_id;

  try {
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado', error_code: 'INVALID_TOKEN' });
    }

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: 'Usuario no tiene empresa asignada',
        error_code: 'COMPANY_NOT_ASSIGNED'
      });
    }

    const deviceIdentifier = getDeviceIdentifier(req);
    const deviceName = req.body.device_name || req.body.deviceName || 'Dispositivo movil';
    const platform = req.body.platform || req.body.platform_name || 'unknown';

    if (!deviceIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Identificador de dispositivo invalido',
        error_code: 'INVALID_DEVICE_ID'
      });
    }

    const deviceExistsRes = await query(
      `SELECT *
       FROM public.user_devices
       WHERE (device_id = $1 OR device_identifier = $1)
         AND company_id = $2`,
      [deviceIdentifier, companyId]
    );
    const existingDevice = deviceExistsRes.rows[0];

    if (existingDevice) {
      if (existingDevice.user_id === userId) {
        if (existingDevice.is_blocked) {
          return res.status(403).json({
            success: false,
            message: 'Dispositivo bloqueado',
            error_code: 'DEVICE_BLOCKED'
          });
        }

        const updateRes = await query(
          `UPDATE public.user_devices
           SET last_login_at = NOW(),
               last_used_at = NOW(),
               device_name = $1,
               platform = $2,
               is_blocked = false,
               is_authorized = true,
               is_active = true,
               revoked_at = NULL,
               revoked_reason = NULL
           WHERE id = $3
           RETURNING *`,
          [deviceName, platform, existingDevice.id]
        );

        return res.json({
          success: true,
          message: 'Dispositivo ya registrado',
          data: {
            id: updateRes.rows[0].id,
            device_id: updateRes.rows[0].device_id,
            device_identifier: updateRes.rows[0].device_identifier,
            is_active: true,
            is_blocked: false
          }
        });
      }

      return res.status(409).json({
        success: false,
        message: 'Este dispositivo ya esta registrado por otro usuario.',
        error_code: 'DEVICE_ALREADY_REGISTERED'
      });
    }

    const userDeviceRes = await query(
      'SELECT id FROM public.user_devices WHERE user_id = $1 AND company_id = $2',
      [userId, companyId]
    );

    if (userDeviceRes.rows.length > 0) {
      const usedThisMonth = await countDeviceChangesThisMonth(userId);
      if (usedThisMonth >= MONTHLY_DEVICE_CHANGE_LIMIT) {
        return res.status(409).json({
          success: false,
          message: 'Has superado el limite de 3 cambios de dispositivo este mes.',
          error_code: 'DEVICE_MONTHLY_LIMIT_EXCEEDED'
        });
      }

      const oldDeviceId = userDeviceRes.rows[0].id;
      const changeRes = await query(
        `UPDATE public.user_devices
         SET device_id = $1,
             device_identifier = $1,
             device_name = $2,
             platform = $3,
             last_login_at = NOW(),
             last_used_at = NOW(),
             is_blocked = false,
             is_authorized = true,
             is_active = true,
             revoked_at = NULL,
             revoked_reason = NULL
         WHERE id = $4
         RETURNING *`,
        [deviceIdentifier, deviceName, platform, oldDeviceId]
      );

      await insertDeviceChangeLog({
        userId,
        deviceId: deviceIdentifier,
        action: 'CHANGE_DEVICE',
        req
      });

      await logAudit({
        userId,
        companyId,
        module: 'DEVICES',
        action: 'CHANGE_DEVICE',
        entity: 'user_devices',
        entityId: oldDeviceId,
        newData: changeRes.rows[0],
        req
      });

      return res.json({
        success: true,
        message: 'Dispositivo actualizado correctamente',
        data: {
          id: changeRes.rows[0].id,
          device_id: changeRes.rows[0].device_id,
          device_identifier: changeRes.rows[0].device_identifier,
          is_active: true,
          is_blocked: false
        }
      });
    }

    const insertRes = await query(
      `INSERT INTO public.user_devices (
        user_id, company_id, device_id, device_identifier, device_name,
        platform, is_authorized, is_trusted, is_blocked, is_active, registered_at, last_login_at
      )
      VALUES ($1::uuid, $2::uuid, $3::varchar, $4::text, $5::text, $6::varchar, true, true, false, true, NOW(), NOW())
      RETURNING *`,
      [userId, companyId, deviceIdentifier, deviceIdentifier, deviceName, platform]
    );

    await logAudit({
      userId,
      companyId,
      module: 'DEVICES',
      action: 'REGISTER',
      entity: 'user_devices',
      entityId: insertRes.rows[0].id,
      newData: insertRes.rows[0],
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Dispositivo registrado correctamente',
      data: {
        id: insertRes.rows[0].id,
        device_id: insertRes.rows[0].device_id,
        device_identifier: insertRes.rows[0].device_identifier,
        is_active: true,
        is_blocked: false
      }
    });
  } catch (error) {
    logger.logError('DEVICES', 'Error interno al registrar dispositivo', error, { userId, body: req.body });

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'El dispositivo ya esta registrado',
        error_code: 'DEVICE_ALREADY_REGISTERED'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error interno al registrar dispositivo',
      error_code: 'INTERNAL_SERVER_ERROR',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

exports.getMyDevices = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, device_id, device_identifier, device_name, brand, model, platform,
              os_version, push_token, is_trusted, is_blocked, is_authorized,
              COALESCE(is_active, true) AS is_active, revoked_at, revoked_reason,
              registered_at, last_used_at, last_login_at
       FROM public.user_devices
       WHERE user_id = $1::uuid`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.revokeCurrentDevice = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.tenantId || req.user.company_id;
    const deviceIdentifier = getDeviceIdentifier(req);
    const refreshToken = req.body?.refreshToken || req.body?.refresh_token || null;

    if (!deviceIdentifier) {
      return res.status(400).json({
        success: false,
        error_code: 'INVALID_DEVICE_ID',
        message: 'Identificador de dispositivo invalido.'
      });
    }

    const existingDeviceRes = await query(
      `SELECT id, device_id, device_identifier, is_authorized, is_blocked, COALESCE(is_active, true) AS is_active
       FROM public.user_devices
       WHERE user_id = $1::uuid
         AND company_id = $2::uuid
         AND (device_id = $3 OR device_identifier = $3)
       LIMIT 1`,
      [userId, companyId, deviceIdentifier]
    );

    if (existingDeviceRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error_code: 'DEVICE_NOT_REGISTERED',
        message: 'Este dispositivo no esta registrado.'
      });
    }

    const existingDevice = existingDeviceRes.rows[0];

    if (existingDevice.is_blocked) {
      return res.status(403).json({
        success: false,
        error_code: 'DEVICE_BLOCKED',
        message: 'El dispositivo esta bloqueado.'
      });
    }

    if (!existingDevice.is_active || existingDevice.is_authorized === false) {
      return res.status(404).json({
        success: false,
        error_code: 'DEVICE_NOT_REGISTERED',
        message: 'Este dispositivo no esta registrado.'
      });
    }

    const usedThisMonth = await countDeviceChangesThisMonth(userId);
    if (usedThisMonth >= MONTHLY_DEVICE_CHANGE_LIMIT) {
      return res.status(409).json({
        success: false,
        error_code: 'DEVICE_MONTHLY_LIMIT_EXCEEDED',
        message: 'Has superado el limite de 3 cambios de dispositivo este mes.'
      });
    }

    const deviceRes = await query(
      `UPDATE public.user_devices
       SET is_authorized = false,
           is_active = false,
           revoked_at = NOW(),
           revoked_reason = 'USER_REQUEST',
           last_used_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, device_id, device_identifier, is_authorized, is_blocked, is_active, revoked_at, revoked_reason`,
      [existingDevice.id]
    );

    if (refreshToken) {
      await query(
        'UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND token = $2',
        [userId, refreshToken]
      );
    }

    await insertDeviceChangeLog({
      userId,
      deviceId: existingDevice.device_identifier || existingDevice.device_id,
      action: 'REVOKE_CURRENT_DEVICE',
      req
    });

    await logAudit({
      userId,
      companyId,
      module: 'DEVICES',
      action: 'REVOKE_CURRENT_DEVICE',
      entity: 'user_devices',
      entityId: deviceRes.rows[0].id,
      newData: deviceRes.rows[0],
      req
    });

    const usedAfter = usedThisMonth + 1;

    return res.json({
      success: true,
      message: 'Dispositivo eliminado correctamente.',
      data: {
        monthlyLimit: MONTHLY_DEVICE_CHANGE_LIMIT,
        usedThisMonth: usedAfter,
        remainingThisMonth: Math.max(MONTHLY_DEVICE_CHANGE_LIMIT - usedAfter, 0)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getUserDevices = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const tenantId = req.tenantId;

    const result = await query(
      'SELECT * FROM public.user_devices WHERE user_id = $1::uuid AND company_id = $2::uuid ORDER BY created_at DESC',
      [userId, tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.trustDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const deviceRes = await query(
      'UPDATE public.user_devices SET is_trusted = true WHERE id = $1::uuid AND company_id = $2::uuid RETURNING *',
      [id, tenantId]
    );

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado.' });
    }

    res.json({ success: true, data: deviceRes.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.blockDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const deviceRes = await query(
      `UPDATE public.user_devices
       SET is_blocked = true, is_authorized = false, is_active = false
       WHERE id = $1::uuid AND company_id = $2::uuid
       RETURNING *`,
      [id, tenantId]
    );

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado.' });
    }

    res.json({ success: true, data: deviceRes.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.unblockDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const deviceRes = await query(
      `UPDATE public.user_devices
       SET is_blocked = false, is_authorized = true, is_active = true, revoked_at = NULL, revoked_reason = NULL
       WHERE id = $1::uuid AND company_id = $2::uuid
       RETURNING *`,
      [id, tenantId]
    );

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado.' });
    }

    res.json({ success: true, data: deviceRes.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.deleteDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    await query('DELETE FROM public.user_devices WHERE id = $1::uuid AND company_id = $2::uuid', [id, tenantId]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
