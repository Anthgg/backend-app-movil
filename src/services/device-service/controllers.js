const { query } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const logger = require('../../shared/utils/logger');

exports.registerDevice = async (req, res, next) => {
  // 1. Validar usuario autenticado
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: 'Usuario no autenticado', error_code: 'INVALID_TOKEN' });
  }

  // 2. Normalizar entrada
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

  const userId = req.user.id;
  const companyId = req.tenantId || req.user.company_id;

  // 3. Validar identificador requerido
  if (!deviceIdentifier) {
    return res.status(400).json({ success: false, message: 'El identificador del dispositivo es requerido', error_code: 'DEVICE_IDENTIFIER_REQUIRED' });
  }

  try {
    await query('BEGIN');

    // 4. Validar si el dispositivo pertenece a OTRO usuario
    const deviceCheck = await query(
      'SELECT user_id FROM public.user_devices WHERE (device_id = $1::text OR device_identifier = $1::text) AND company_id = $2::uuid',
      [deviceIdentifier, companyId]
    );

    if (deviceCheck.rows.length > 0 && deviceCheck.rows[0].user_id !== userId) {
      await query('ROLLBACK');
      return res.status(409).json({ 
        success: false, 
        message: 'Este dispositivo ya está registrado por otro usuario en la empresa.',
        error_code: 'DEVICE_ALREADY_REGISTERED'
      });
    }

    // 5. Validar límite de cambios (3 por mes)
    // Solo contamos si el dispositivo actual del usuario es distinto al que intenta registrar
    const currentUserDevice = await query(
      'SELECT device_id, device_identifier FROM public.user_devices WHERE user_id = $1::uuid',
      [userId]
    );

    const isNewDevice = currentUserDevice.rows.length === 0 || 
      (currentUserDevice.rows[0].device_id !== deviceIdentifier && currentUserDevice.rows[0].device_identifier !== deviceIdentifier);

    if (isNewDevice) {
      const changeCountRes = await query(
        `SELECT COUNT(*) FROM public.audit_logs 
         WHERE user_id = $1::uuid 
           AND module = 'DEVICES' 
           AND action = 'REGISTER' 
           AND created_at > NOW() - INTERVAL '1 month'`,
        [userId]
      );
      
      const changeCount = parseInt(changeCountRes.rows[0].count, 10);
      if (changeCount >= 3) {
        await query('ROLLBACK');
        return res.status(409).json({ 
          success: false, 
          message: 'Límite de cambios de dispositivo excedido (máximo 3 por mes).',
          error_code: 'DEVICE_CHANGE_LIMIT_EXCEEDED'
        });
      }
    }

    // 6. Ejecutar UPSERT con tipos explícitos y sin reutilizar placeholders para tipos distintos
    // Usamos placeholders únicos para evitar el error de deducción de tipos
    const upsertQuery = `
      INSERT INTO public.user_devices (
        user_id,
        company_id,
        device_id,
        device_identifier,
        device_name,
        platform,
        is_authorized,
        is_blocked,
        is_trusted,
        registered_at,
        last_login_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::text,
        $5::text,
        $6::text,
        $7::boolean,
        $8::boolean,
        $9::boolean,
        now(),
        now()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        company_id = EXCLUDED.company_id,
        device_id = EXCLUDED.device_id,
        device_identifier = EXCLUDED.device_identifier,
        device_name = EXCLUDED.device_name,
        platform = EXCLUDED.platform,
        is_authorized = true,
        is_blocked = false,
        last_login_at = now()
      RETURNING *;
    `;

    const values = [
      userId,           // $1
      companyId,        // $2
      deviceIdentifier, // $3 (como device_id)
      deviceIdentifier, // $4 (como device_identifier)
      deviceName,       // $5
      platform,         // $6
      true,             // $7 (is_authorized)
      false,            // $8 (is_blocked)
      true              // $9 (is_trusted)
    ];

    const result = await query(upsertQuery, values);
    const registeredDevice = result.rows[0];

    // 7. Auditoría
    if (isNewDevice) {
      await logAudit({
        userId,
        companyId,
        module: 'DEVICES',
        action: 'REGISTER',
        entity: 'user_devices',
        entityId: registeredDevice.id,
        newData: { device_id: deviceIdentifier, device_name: deviceName, platform },
        req
      });
    }

    await query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Dispositivo registrado correctamente',
      data: registeredDevice
    });

  } catch (error) {
    await query('ROLLBACK');
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

