const { query } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const logger = require('../../shared/utils/logger');

exports.registerDevice = async (req, res, next) => {
  const userId = req.user?.id;
  const companyId = req.tenantId || req.user?.company_id;

  try {
    // 1. Validar autenticación
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

    // 2. Normalizar entrada
    const deviceIdentifier =
      req.body.device_identifier ||
      req.body.device_id ||
      req.body.deviceId ||
      req.headers['x-device-identifier'] ||
      req.headers['x-device-id'];

    const deviceName = req.body.device_name || req.body.deviceName || 'Dispositivo móvil';
    const platform = req.body.platform || req.body.platform_name || 'unknown';

    if (!deviceIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Identificador de dispositivo requerido',
        error_code: 'DEVICE_IDENTIFIER_REQUIRED'
      });
    }

    // 3. Buscar si el dispositivo ya existe (para cualquier usuario)
    const deviceExistsRes = await query(
      'SELECT * FROM public.user_devices WHERE (device_id = $1 OR device_identifier = $1) AND company_id = $2',
      [deviceIdentifier, companyId]
    );
    const existingDevice = deviceExistsRes.rows[0];

    // --- CASO 1: Dispositivo ya registrado ---
    if (existingDevice) {
      // Si pertenece al mismo usuario
      if (existingDevice.user_id === userId) {
        // Verificar si está bloqueado
        if (existingDevice.is_blocked) {
          return res.status(403).json({
            success: false,
            message: 'Dispositivo bloqueado',
            error_code: 'DEVICE_BLOCKED'
          });
        }

        // Idempotencia: Actualizar última conexión y devolver éxito
        const updateRes = await query(
          `UPDATE public.user_devices 
           SET last_login_at = NOW(), last_used_at = NOW(), device_name = $1, platform = $2 
           WHERE id = $3 RETURNING *`,
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
      } else {
        // Pertenece a otro usuario
        return res.status(409).json({
          success: false,
          message: 'Este dispositivo ya está registrado por otro usuario.',
          error_code: 'DEVICE_ALREADY_REGISTERED'
        });
      }
    }

    // --- CASO 2: Usuario ya tiene otro dispositivo ---
    const userDeviceRes = await query(
      'SELECT id FROM public.user_devices WHERE user_id = $1 AND company_id = $2',
      [userId, companyId]
    );

    if (userDeviceRes.rows.length > 0) {
      // Validar límite de cambios (3 por mes)
      const changeCountRes = await query(
        `SELECT COUNT(*) FROM public.audit_logs 
         WHERE user_id = $1 AND module = 'DEVICES' AND action = 'CHANGE_DEVICE' 
         AND created_at > NOW() - INTERVAL '1 month'`,
        [userId]
      );
      if (parseInt(changeCountRes.rows[0].count) >= 3) {
        return res.status(409).json({
          success: false,
          message: 'Ya alcanzaste el límite de cambios de dispositivo este mes',
          error_code: 'DEVICE_CHANGE_LIMIT_EXCEEDED'
        });
      }

      // Actualizar registro existente al nuevo dispositivo
      const oldDeviceId = userDeviceRes.rows[0].id;
      const changeRes = await query(
        `UPDATE public.user_devices 
         SET device_id = $1, device_identifier = $1, device_name = $2, platform = $3, 
             last_login_at = NOW(), last_used_at = NOW(), is_blocked = false, is_authorized = true
         WHERE id = $4 RETURNING *`,
        [deviceIdentifier, deviceName, platform, oldDeviceId]
      );

      await logAudit({
        userId, companyId, module: 'DEVICES', action: 'CHANGE_DEVICE',
        entity: 'user_devices', entityId: oldDeviceId, newData: changeRes.rows[0], req
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

    // --- CASO 3: Primer registro de dispositivo ---
    const insertRes = await query(
      `INSERT INTO public.user_devices (
        user_id, company_id, device_id, device_identifier, device_name, 
        platform, is_authorized, is_trusted, is_blocked, registered_at, last_login_at
      )
      VALUES ($1::uuid, $2::uuid, $3::varchar, $4::text, $5::text, $6::varchar, true, true, false, NOW(), NOW())
      RETURNING *`,
      [userId, companyId, deviceIdentifier, deviceIdentifier, deviceName, platform]
    );

    await logAudit({
      userId, companyId, module: 'DEVICES', action: 'REGISTER',
      entity: 'user_devices', entityId: insertRes.rows[0].id, newData: insertRes.rows[0], req
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
        message: 'El dispositivo ya está registrado',
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
              os_version, push_token, is_trusted, is_blocked, registered_at, last_used_at, last_login_at 
       FROM public.user_devices 
       WHERE user_id = $1::uuid`, 
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
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
      'UPDATE public.user_devices SET is_blocked = true, is_authorized = false WHERE id = $1::uuid AND company_id = $2::uuid RETURNING *',
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
      'UPDATE public.user_devices SET is_blocked = false, is_authorized = true WHERE id = $1::uuid AND company_id = $2::uuid RETURNING *',
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
