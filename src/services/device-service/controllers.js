const { query } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const logger = require('../../shared/utils/logger');

exports.registerDevice = async (req, res, next) => {
  try {
    // 1. Obtener datos básicos
    const userId = req.user?.id;
    const companyId = req.tenantId || req.user?.company_id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado', error_code: 'INVALID_TOKEN' });
    }

    // 2. Normalizar entrada desde Body o Headers
    const deviceIdentifier =
      req.body.device_identifier ||
      req.body.device_id ||
      req.body.deviceId ||
      req.headers['x-device-identifier'] ||
      req.headers['x-device-id'];

    const deviceName =
      req.body.device_name ||
      req.body.deviceName ||
      'Dispositivo móvil';

    const platform =
      req.body.platform ||
      req.body.platform_name ||
      'unknown';

    // 3. Validar identificador requerido (Regla 5)
    if (!deviceIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Identificador de dispositivo requerido',
        error_code: 'DEVICE_IDENTIFIER_REQUIRED'
      });
    }

    await query('BEGIN');

    // 4. Buscar dispositivo actual del usuario (Regla 1, 2, 3)
    const currentUserDeviceRes = await query(
      'SELECT * FROM public.user_devices WHERE user_id = $1::uuid LIMIT 1',
      [userId]
    );
    const currentDevice = currentUserDeviceRes.rows[0];

    // --- CASO 1: El usuario NO tiene ningún dispositivo registrado (Regla 1) ---
    if (!currentDevice) {
      // Validar si el dispositivo está tomado por otro usuario
      const otherUserRes = await query(
        'SELECT user_id FROM public.user_devices WHERE (device_id = $1::text OR device_identifier = $1::text) AND company_id = $2::uuid',
        [deviceIdentifier, companyId]
      );
      if (otherUserRes.rows.length > 0) {
        await query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Este dispositivo ya está registrado por otro usuario.',
          error_code: 'DEVICE_ALREADY_REGISTERED'
        });
      }

      const insertRes = await query(
        `INSERT INTO public.user_devices (
          user_id, company_id, device_id, device_identifier, device_name, 
          platform, is_authorized, is_trusted, is_blocked, registered_at, last_login_at
        )
        VALUES ($1::uuid, $2::uuid, $3::text, $3::text, $4::text, $5::text, true, true, false, now(), now())
        RETURNING *`,
        [userId, companyId, deviceIdentifier, deviceName, platform]
      );

      await logAudit({
        userId, companyId, module: 'DEVICES', action: 'REGISTER',
        entity: 'user_devices', entityId: insertRes.rows[0].id, newData: insertRes.rows[0], req
      });

      await query('COMMIT');
      return res.status(201).json({
        success: true,
        message: 'Dispositivo registrado correctamente',
        data: insertRes.rows[0]
      });
    }

    // --- CASO 2: El usuario ya tiene este MISMO dispositivo (Regla 2) ---
    if (currentDevice.device_id === deviceIdentifier || currentDevice.device_identifier === deviceIdentifier) {
      const updateRes = await query(
        `UPDATE public.user_devices 
         SET last_login_at = now(), 
             last_used_at = now(),
             device_name = $2::text,
             platform = $3::text
         WHERE id = $1::uuid RETURNING *`,
        [currentDevice.id, deviceName, platform]
      );

      await query('COMMIT');
      return res.json({
        success: true,
        message: 'Dispositivo verificado',
        data: updateRes.rows[0]
      });
    }

    // --- CASO 3: El usuario quiere cambiar a un OTRO dispositivo (Regla 3 y 4) ---
    
    // Validar si el NUEVO dispositivo está tomado por otro usuario
    const otherUserRes = await query(
      'SELECT user_id FROM public.user_devices WHERE (device_id = $1::text OR device_identifier = $1::text) AND company_id = $2::uuid',
      [deviceIdentifier, companyId]
    );
    if (otherUserRes.rows.length > 0) {
      await query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'El nuevo dispositivo ya está registrado por otro usuario.',
        error_code: 'DEVICE_ALREADY_REGISTERED'
      });
    }

    // Validar límite de cambios (máximo 3 por mes)
    const changeCountRes = await query(
      `SELECT COUNT(*) FROM public.audit_logs 
       WHERE user_id = $1::uuid 
         AND module = 'DEVICES' 
         AND action = 'CHANGE_DEVICE' 
         AND created_at > NOW() - INTERVAL '1 month'`,
      [userId]
    );
    const changeCount = parseInt(changeCountRes.rows[0].count, 10);

    if (changeCount >= 3) {
      await query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Ya alcanzaste el limite de 3 cambios de dispositivo este mes',
        error_code: 'DEVICE_CHANGE_LIMIT_EXCEEDED'
      });
    }

    // Actualizar al nuevo dispositivo
    const finalUpdateRes = await query(
      `UPDATE public.user_devices 
       SET device_id = $2::text,
           device_identifier = $2::text,
           device_name = $3::text,
           platform = $4::text,
           last_login_at = now(),
           last_used_at = now()
       WHERE id = $1::uuid RETURNING *`,
      [currentDevice.id, deviceIdentifier, deviceName, platform]
    );

    await logAudit({
      userId, companyId, module: 'DEVICES', action: 'CHANGE_DEVICE',
      entity: 'user_devices', entityId: currentDevice.id, 
      oldData: currentDevice,
      newData: finalUpdateRes.rows[0], 
      req
    });

    await query('COMMIT');
    return res.json({
      success: true,
      message: 'Dispositivo actualizado correctamente',
      data: finalUpdateRes.rows[0]
    });

  } catch (error) {
    if (query.activeTransaction) await query('ROLLBACK');
    logger.logError('DEVICE_REGISTER_ERROR', error);
    next(error);
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

