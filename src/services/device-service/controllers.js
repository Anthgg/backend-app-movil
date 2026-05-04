const { query } = require('../../config/database');
const { logAudit } = require('../../shared/utils/audit');

exports.registerDevice = async (req, res, next) => {
  const { device_identifier, device_name } = req.body;
  const userId = req.user.id;
  const tenantId = req.tenantId;

  try {
    await query('BEGIN');

    const existingDevice = await query(
      'SELECT id, user_id FROM user_devices WHERE device_id = $1 AND company_id = $2',
      [device_identifier, tenantId]
    );

    if (existingDevice.rows.length > 0) {
      if (existingDevice.rows[0].user_id !== userId) {
        return res.status(409).json({ success: false, message: 'Este dispositivo ya está registrado por otro usuario en la empresa.' });
      }
      // Si ya es del usuario, simplemente actualizamos la fecha y devolvemos el dispositivo
      const updatedDeviceRes = await query('UPDATE user_devices SET last_login_at = NOW() WHERE id = $1 RETURNING *', [existingDevice.rows[0].id]);
      return res.status(200).json({ success: true, data: updatedDeviceRes.rows[0] });
    }

    // Contar cuántos dispositivos tiene el usuario
    const deviceCountRes = await query('SELECT COUNT(*) FROM user_devices WHERE user_id = $1', [userId]);
    const isFirstDevice = parseInt(deviceCountRes.rows[0].count, 10) === 0;

    const newDeviceRes = await query(
      `INSERT INTO user_devices (user_id, company_id, device_id, device_name, is_trusted, last_login_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [userId, tenantId, device_identifier, device_name, isFirstDevice]
    );
    const newDevice = newDeviceRes.rows[0];

    await logAudit({
      userId, companyId: tenantId, module: 'DEVICES', action: 'REGISTER',
      entity: 'user_devices', entityId: newDevice.id, newData: { device_id: device_identifier, device_name }, req
    });

    await query('COMMIT');
    res.status(201).json({ success: true, data: newDevice });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};

exports.getMyDevices = async (req, res, next) => {
  try {
    const result = await query('SELECT id, device_id, brand, model, is_blocked, registered_at, last_used_at FROM user_devices WHERE user_id = $1', [req.user.id]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.getUserDevices = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const tenantId = req.tenantId;

    const userCheck = await query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [userId, tenantId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const result = await query('SELECT * FROM user_devices WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
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
      'UPDATE user_devices SET is_trusted = true WHERE id = $1 AND company_id = $2 RETURNING *',
      [id, tenantId]
    );

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado.' });
    }

    await logAudit({ userId: req.user.id, companyId: tenantId, module: 'DEVICES', action: 'TRUST', entity: 'user_devices', entityId: id, req });
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
      'UPDATE user_devices SET is_blocked = true WHERE id = $1 AND company_id = $2 RETURNING *',
      [id, tenantId]
    );

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado.' });
    }

    await logAudit({ userId: req.user.id, companyId: tenantId, module: 'DEVICES', action: 'BLOCK', entity: 'user_devices', entityId: id, req });
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
      'UPDATE user_devices SET is_blocked = false WHERE id = $1 AND company_id = $2 RETURNING *',
      [id, tenantId]
    );

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado.' });
    }

    await logAudit({ userId: req.user.id, companyId: tenantId, module: 'DEVICES', action: 'UNBLOCK', entity: 'user_devices', entityId: id, req });
    res.json({ success: true, data: deviceRes.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.deleteDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;
    const tenantId = req.tenantId;

    const deviceRes = await query('SELECT user_id FROM user_devices WHERE id = $1 AND company_id = $2', [id, tenantId]);

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado.' });
    }

    const deviceOwnerId = deviceRes.rows[0].user_id;
    const canDelete = currentUserId === deviceOwnerId || req.user.permissions.includes('devices.delete');

    if (!canDelete) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para eliminar este dispositivo.' });
    }

    await query('DELETE FROM user_devices WHERE id = $1', [id]);
    await logAudit({ userId: currentUserId, companyId: tenantId, module: 'DEVICES', action: 'DELETE', entity: 'user_devices', entityId: id, req });
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
