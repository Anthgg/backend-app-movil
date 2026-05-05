const { query } = require('../../config/database');
const logger = require('../../shared/utils/logger');
const { logAudit } = require('../../shared/utils/audit');

exports.getMyNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { limit = 20, markAsRead = false } = req.query;

    const result = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );

    if (markAsRead === 'true') {
      await query(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [userId]);
    }

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};
const bcrypt = require('bcryptjs');

const validateTargetUser = async (targetId, currentUserId, currentRoles, tenantId) => {
  if (targetId === currentUserId) throw new Error('No puedes modificar tu propio estado.');

  const targetRes = await query('SELECT id, company_id, status FROM users WHERE id = $1 AND deleted_at IS NULL', [targetId]);
  const targetUser = targetRes.rows[0];

  if (!targetUser) throw new Error('Usuario no encontrado.');
  
  if (!currentRoles.includes('ADMIN')) {
      if (targetUser.company_id !== tenantId) throw new Error('Usuario pertenece a otra empresa.');
      
      const roleRes = await query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = $1', [targetId]);
      const targetRoles = roleRes.rows.map(r => r.name);
      if (targetRoles.includes('ADMIN')) throw new Error('No tienes permiso para modificar a un Administrador.');
  }

  return targetUser;
};

const changeStatus = async (req, res, next, newStatus, isActive) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const currentUserId = req.user.id;
    const tenantId = req.tenantId;

    const targetUser = await validateTargetUser(id, currentUserId, req.user.roles, tenantId);

    await query('BEGIN');
    
    if (!isActive) {
      // Revocar tokens
      await query('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [id]);
      // Bloquear dispositivos
      await query('UPDATE user_devices SET is_blocked = true WHERE user_id = $1', [id]);
    }

    await query(`
      UPDATE users 
      SET is_active = $1, status = $2, disabled_at = $3, disabled_by = $4, disabled_reason = $5
      WHERE id = $6
    `, [isActive, newStatus, isActive ? null : 'NOW()', isActive ? null : currentUserId, isActive ? null : reason, id]);

    // Historial
    await query(`
      INSERT INTO user_status_history (user_id, old_status, new_status, changed_by, reason)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, targetUser.status, newStatus, currentUserId, reason]);

    await logAudit({
      userId: currentUserId, companyId: tenantId, module: 'USERS', action: newStatus.toUpperCase(),
      entity: 'users', entityId: id, oldData: { status: targetUser.status }, newData: { status: newStatus, reason }, req
    });

    await query('COMMIT');
    logger.logChange('USERS', `Usuario ${newStatus}`, { targetId: id, by: currentUserId, reason });

    res.json({ success: true, message: `Estado del usuario actualizado a ${newStatus}` });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};

exports.disableUser = (req, res, next) => changeStatus(req, res, next, 'inactive', false);
exports.enableUser = (req, res, next) => changeStatus(req, res, next, 'active', true);
exports.blockUser = (req, res, next) => changeStatus(req, res, next, 'blocked', false);
exports.suspendUser = (req, res, next) => changeStatus(req, res, next, 'suspended', false);

exports.getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    const tenantId = req.tenantId;

    const result = await query(`
      SELECT u.id,
             CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.first_name, u.last_name,
             u.email, u.is_active, u.created_at, r.name as role
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.company_id = $1 AND u.deleted_at IS NULL
      ORDER BY u.created_at DESC
      LIMIT $2 OFFSET $3
    `, [tenantId, limit, offset]);

    const totalRes = await query('SELECT COUNT(*) FROM users WHERE company_id = $1 AND deleted_at IS NULL', [tenantId]);
    const total = parseInt(totalRes.rows[0].count, 10);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const result = await query(`
      SELECT u.id,
             CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.first_name, u.last_name,
             u.email, u.is_active, u.created_at, r.name as role
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1 AND u.company_id = $2 AND u.deleted_at IS NULL
    `, [id, tenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.createUser = async (req, res, next) => {
  // Acepta full_name (compat.) o first_name/last_name por separado
  const { full_name, first_name, last_name, email, password, role } = req.body;
  const resolvedFirst = first_name || (full_name ? full_name.split(' ')[0] : '');
  const resolvedLast  = last_name  || (full_name ? full_name.split(' ').slice(1).join(' ') : '');
  const tenantId = req.tenantId;
  const creatorId = req.user.id;

  try {
    await query('BEGIN');

    const emailExists = await query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
    if (emailExists.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'El correo electrónico ya está en uso.' });
    }

    const roleRecord = await query('SELECT id FROM roles WHERE name = $1', [role]);
    if (roleRecord.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'El rol especificado no es válido.' });
    }
    const roleId = roleRecord.rows[0].id;

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUserRes = await query(
      'INSERT INTO users (first_name, last_name, email, password_hash, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [resolvedFirst, resolvedLast, email, hashedPassword, tenantId]
    );
    const newUser = newUserRes.rows[0];

    await query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [newUser.id, roleId]);

    await logAudit({
      userId: creatorId, companyId: tenantId, module: 'USERS', action: 'CREATE',
      entity: 'users', entityId: newUser.id, newData: { email, role }, req
    });

    await query('COMMIT');

    delete newUser.password_hash;
    newUser.full_name = [resolvedFirst, resolvedLast].filter(Boolean).join(' ');
    newUser.role = role;

    res.status(201).json({ success: true, data: newUser });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { full_name, first_name, last_name, email, role, is_active } = req.body;
    const tenantId = req.tenantId;
    const updaterId = req.user.id;

    await query('BEGIN');

    const userRes = await query('SELECT * FROM users WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [id, tenantId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    const oldData = userRes.rows[0];

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    // Soporte para first_name / last_name o full_name (compat.)
    const newFirst = first_name !== undefined ? first_name : (full_name ? full_name.split(' ')[0] : undefined);
    const newLast  = last_name  !== undefined ? last_name  : (full_name ? full_name.split(' ').slice(1).join(' ') : undefined);

    if (newFirst !== undefined) { updateFields.push(`first_name = $${paramCount++}`); updateValues.push(newFirst); }
    if (newLast  !== undefined) { updateFields.push(`last_name = $${paramCount++}`);  updateValues.push(newLast); }

    if (email !== undefined) {
      const emailExists = await query('SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL', [email, id]);
      if (emailExists.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'El correo electrónico ya está en uso.' });
      }
      updateFields.push(`email = $${paramCount++}`);
      updateValues.push(email);
    }
    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramCount++}`);
      updateValues.push(is_active);
    }

    let updatedUser;
    if (updateFields.length > 0) {
      updateValues.push(updaterId, id);
      const updatedUserRes = await query(
        `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW(), updated_by = $${paramCount++} WHERE id = $${paramCount} RETURNING *`,
        updateValues
      );
      updatedUser = updatedUserRes.rows[0];
    } else {
      updatedUser = oldData;
    }

    if (role) {
      const roleRecord = await query('SELECT id FROM roles WHERE name = $1', [role]);
      if (roleRecord.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'El rol especificado no es válido.' });
      }
      const roleId = roleRecord.rows[0].id;
      await query('UPDATE user_roles SET role_id = $1 WHERE user_id = $2', [roleId, id]);
    }

    await logAudit({
      userId: updaterId, companyId: tenantId, module: 'USERS', action: 'UPDATE',
      entity: 'users', entityId: id, oldData: { email: oldData.email }, newData: { email, role }, req
    });

    await query('COMMIT');

    const finalUserRes = await query(`
      SELECT u.id,
             CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.first_name, u.last_name,
             u.email, u.is_active, u.created_at, r.name as role
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1
    `, [id]);

    res.json({ success: true, data: finalUserRes.rows[0] });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const deleterId = req.user.id;

    const userRes = await query('SELECT * FROM users WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [id, tenantId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    await query('UPDATE users SET deleted_at = NOW(), is_active = false, status = \'deleted\', deleted_by = $1 WHERE id = $2', [deleterId, id]);
    
    await logAudit({
      userId: deleterId, companyId: tenantId, module: 'USERS', action: 'DELETE',
      entity: 'users', entityId: id, oldData: { id }, req
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

exports.getStatus = async (req, res, next) => {
  try {
    // Validar tenant implícito
    const whereClause = req.user.roles.includes('ADMIN') ? 'id = $1' : 'id = $1 AND company_id = $2';
    const params = req.user.roles.includes('ADMIN') ? [req.params.id] : [req.params.id, req.tenantId];

    const result = await query(`SELECT id, is_active, status, disabled_at, disabled_reason FROM users WHERE ${whereClause} AND deleted_at IS NULL`, params);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};
