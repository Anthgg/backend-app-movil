const { query } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');
const logger = require('../../shared/utils/logger');
const sessionService = require('../profile-service/session.service');
const { insertReturning, updateReturning } = require('../../utils/db.util');

const MONTHLY_DEVICE_CHANGE_LIMIT = 3;

function getDeviceIdentifier(req) {
  return (
    req.body?.deviceId ||
    req.body?.device_id ||
    req.body?.deviceIdentifier ||
    req.body?.device_identifier ||
    req.body?.deviceFingerprint ||
    req.body?.device_fingerprint ||
    req.body?.fingerprint ||
    req.body?.installationId ||
    req.body?.installation_id ||
    req.headers['x-device-id'] ||
    req.headers['x-device-identifier'] ||
    req.headers['x-device-fingerprint'] ||
    null
  );
}

function getBodyValue(body = {}, ...keys) {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function sanitizeDevicePayload(body = {}) {
  const clone = { ...body };
  delete clone.refreshToken;
  delete clone.refresh_token;
  delete clone.token;
  delete clone.accessToken;
  delete clone.access_token;
  return clone;
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
  const isMobileRoute = String(req.originalUrl || req.url || '').includes('/api/mobile/');
  let workerId = null;

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
    const deviceName = getBodyValue(req.body, 'device_name', 'deviceName', 'name')
      || [getBodyValue(req.body, 'brand', 'manufacturer'), getBodyValue(req.body, 'model', 'deviceModel', 'device_model')]
        .filter(Boolean)
        .join(' ')
      || 'Dispositivo movil';
    const platform = getBodyValue(req.body, 'platform', 'platform_name')
      || req.body?.deviceContext?.platform
      || req.body?.deviceInfo?.platform
      || 'unknown';
    const brand = getBodyValue(req.body, 'brand', 'manufacturer');
    const model = getBodyValue(req.body, 'model', 'deviceModel', 'device_model');
    const osVersion = getBodyValue(req.body, 'os_version', 'osVersion', 'androidVersion');
    const appVersion = getBodyValue(req.body, 'app_version', 'appVersion');
    const buildNumber = getBodyValue(req.body, 'build_number', 'buildNumber');
    const pushToken = getBodyValue(req.body, 'push_token', 'pushToken', 'fcmToken', 'fcm_token');

    const workerRes = await query(
      `SELECT id
       FROM workers
       WHERE user_id = $1
         AND company_id = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [userId, companyId]
    );
    workerId = workerRes.rows[0]?.id || null;

    if (isMobileRoute && !workerId) {
      return res.status(404).json({
        success: false,
        message: 'El usuario autenticado no tiene trabajador asociado',
        error_code: 'WORKER_NOT_FOUND'
      });
    }

    console.log('[MOBILE_DEVICE_REGISTER]', {
      userId,
      workerId,
      companyId,
      deviceFingerprint: req.body?.deviceFingerprint || req.body?.device_fingerprint || null,
      platform,
      deviceName,
      appVersion
    });

    if (req.user?.sessionId) {
      sessionService.updateCurrentSessionContext({
        userId,
        workerId,
        sessionId: req.user.sessionId,
        req,
        source: 'mobile_app'
      }).catch((error) => {
        logger.logWarn('DEVICES', 'No se pudo actualizar contexto de sesion movil', {
          user_id: userId,
          session_id: req.user.sessionId,
          error: error.message
        });
      });
    }

    if (!deviceIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Datos de dispositivo incompletos o invalidos',
        error_code: 'DEVICE_PAYLOAD_INVALID'
      });
    }

    const deviceValues = {
      user_id: userId,
      company_id: companyId,
      device_id: deviceIdentifier,
      device_identifier: deviceIdentifier,
      device_name: deviceName,
      brand,
      manufacturer: brand,
      model,
      os_version: osVersion,
      app_version: appVersion,
      build_number: buildNumber,
      push_token: pushToken,
      platform,
      is_authorized: true,
      is_trusted: true,
      is_blocked: false,
      is_active: true,
      revoked_at: null,
      revoked_reason: null,
      last_login_at: new Date(),
      last_used_at: new Date(),
      updated_at: new Date()
    };

    const deviceExistsRes = await query(
      `SELECT *
       FROM public.user_devices
       WHERE device_id::text = $1::text
          OR device_identifier::text = $1::text
       ORDER BY CASE WHEN user_id = $2::uuid THEN 0 ELSE 1 END
       LIMIT 1`,
      [deviceIdentifier, userId]
    );
    const existingDevice = deviceExistsRes.rows[0];

    if (existingDevice && existingDevice.user_id !== userId) {
      return res.status(409).json({
        success: false,
        message: 'Este dispositivo ya esta registrado por otro usuario.',
        error_code: 'DEVICE_ALREADY_REGISTERED'
      });
    }

    if (existingDevice?.is_blocked) {
      return res.status(403).json({
        success: false,
        message: 'Dispositivo bloqueado',
        error_code: 'DEVICE_BLOCKED'
      });
    }

    let savedDevice = null;
    let auditAction = 'REGISTER';
    let responseStatus = 201;

    if (existingDevice) {
      savedDevice = await updateReturning({ query }, 'user_devices', 'id', existingDevice.id, deviceValues);
      auditAction = 'UPDATE_DEVICE_CONTEXT';
      responseStatus = 200;
    } else {
      const userDeviceRes = await query(
        `SELECT *
         FROM public.user_devices
         WHERE user_id = $1::uuid
         ORDER BY CASE WHEN company_id = $2::uuid THEN 0 ELSE 1 END,
                  last_login_at DESC NULLS LAST,
                  registered_at DESC NULLS LAST
         LIMIT 1`,
        [userId, companyId]
      );
      const currentUserDevice = userDeviceRes.rows[0];

      if (currentUserDevice) {
        const usedThisMonth = await countDeviceChangesThisMonth(userId);
        if (usedThisMonth >= MONTHLY_DEVICE_CHANGE_LIMIT) {
          return res.status(409).json({
            success: false,
            message: 'Has superado el limite de 3 cambios de dispositivo este mes.',
            error_code: 'DEVICE_MONTHLY_LIMIT_EXCEEDED'
          });
        }

        savedDevice = await updateReturning({ query }, 'user_devices', 'id', currentUserDevice.id, deviceValues);
        auditAction = 'CHANGE_DEVICE';
        responseStatus = 200;

        await insertDeviceChangeLog({
          userId,
          deviceId: deviceIdentifier,
          action: 'CHANGE_DEVICE',
          req
        });
      } else {
        savedDevice = await insertReturning({ query }, 'user_devices', {
          ...deviceValues,
          registered_at: new Date(),
          created_at: new Date()
        });
      }
    }

    await logAudit({
      userId,
      companyId,
      module: 'DEVICES',
      action: auditAction,
      entity: 'user_devices',
      entityId: savedDevice.id,
      newData: savedDevice,
      req
    });

    return res.status(responseStatus).json({
      success: true,
      message: responseStatus === 201 ? 'Dispositivo registrado correctamente' : 'Dispositivo actualizado correctamente',
      data: {
        id: savedDevice.id,
        device_id: savedDevice.device_id,
        device_identifier: savedDevice.device_identifier,
        deviceName: savedDevice.device_name,
        platform: savedDevice.platform,
        is_active: true,
        is_blocked: false
      }
    });
  } catch (error) {
    const payloadSanitized = sanitizeDevicePayload(req.body);
    console.error('[MOBILE_DEVICE_REGISTER_ERROR]', {
      errorCode: error.errorCode || error.code || 'DEVICE_REGISTER_FAILED',
      message: error.message,
      stack: error.stack,
      payloadSanitized
    });
    logger.logError('DEVICES', 'Error al registrar dispositivo', error, { userId, body: payloadSanitized });

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'El dispositivo ya esta registrado',
        error_code: 'DEVICE_ALREADY_REGISTERED'
      });
    }

    res.status(error.statusCode || 500).json({
      success: false,
      message: 'No se pudo registrar la informacion del dispositivo',
      error_code: error.errorCode || 'DEVICE_REGISTER_FAILED',
      details: {
        reason: error.message
      }
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
