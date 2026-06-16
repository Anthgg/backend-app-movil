const { query, withTransaction } = require('../../config/database');
const logger = require('../../shared/utils/logger');
const { logAudit } = require('../../shared/utils/audit');
const { getCompanySettings } = require('../company-settings-service/companySettings.service');
const { generateCorporatePdf } = require('../pdf/pdf-generator.service');
const excelExporter = require('../report-service/exporters/excel.exporter');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { uploadFile } = require('../../shared/utils/storage.utils');
const pdfGenerator = require('../../shared/utils/pdfGenerator');

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

exports.getRoles = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT r.id,
             r.name,
             COALESCE(NULLIF(r.code, ''), UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(r.name), '[^A-Za-z0-9]+', '_', 'g'), '^_|_$', '', 'g'))) AS code,
             LOWER(COALESCE(NULLIF(r.code, ''), UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(r.name), '[^A-Za-z0-9]+', '_', 'g'), '^_|_$', '', 'g')))) AS role,
             COALESCE(NULLIF(r.code, ''), UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(r.name), '[^A-Za-z0-9]+', '_', 'g'), '^_|_$', '', 'g'))) AS role_key,
             r.description,
             COALESCE(r.is_active, TRUE) AS is_active,
             COALESCE(r.is_system_role, FALSE) AS is_system_role,
             r.created_at
      FROM roles r
      WHERE COALESCE(r.is_active, TRUE) = TRUE
        AND r.deleted_at IS NULL
        AND (r.company_id = $1 OR r.company_id IS NULL)
      ORDER BY r.name ASC
    `, [req.tenantId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

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
             u.email, u.is_active, u.created_at, u.last_login_at,
             u.worker_id,
             (u.worker_id IS NOT NULL) AS has_worker_record,
             (
               SELECT STRING_AGG(DISTINCT r.name, ', ')
               FROM roles r
               JOIN user_roles ur ON r.id = ur.role_id
               WHERE ur.user_id = u.id
             ) AS role,
             (
               SELECT NULLIF(jp.name, 'No informado') FROM job_positions jp
               JOIN workers w ON (jp.id = w.job_position_id OR jp.id = w.position_id)
               WHERE w.user_id = u.id AND w.deleted_at IS NULL
               LIMIT 1
             ) AS position,
             COALESCE(
               (
                 SELECT wl.name FROM work_locations wl
                 JOIN workers w ON w.work_location_id = wl.id
                 WHERE w.user_id = u.id AND w.deleted_at IS NULL
                 LIMIT 1
               ),
               (
                 SELECT wl.name FROM work_locations wl
                 JOIN work_crews wc ON wc.work_location_id = wl.id
                 WHERE wc.supervisor_id = u.id AND wc.deleted_at IS NULL
                 LIMIT 1
               )
             ) AS project,
             CASE WHEN u.worker_id IS NOT NULL THEN
               json_build_object(
                 'id', u.worker_id,
                 'position', (
                   SELECT NULLIF(jp.name, 'No informado') FROM job_positions jp
                   JOIN workers w ON (jp.id = w.job_position_id OR jp.id = w.position_id)
                   WHERE w.id = u.worker_id
                   LIMIT 1
                 ),
                 'area_name', COALESCE(
                   (SELECT a.name FROM areas a JOIN workers w ON a.id = w.area_id WHERE w.id = u.worker_id LIMIT 1),
                   (SELECT d.name FROM departments d JOIN workers w ON d.id = w.internal_department_id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'work_location_name', COALESCE(
                   (SELECT wl.name FROM work_locations wl JOIN workers w ON w.work_location_id = wl.id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 )
               )
             ELSE NULL END AS worker,
             (
               SELECT json_build_object(
                 'id', wc.id,
                 'name', wc.name,
                 'work_location_name', wl.name
               )
               FROM work_crews wc
               JOIN work_locations wl ON wl.id = wc.work_location_id
               WHERE wc.supervisor_id = u.id AND wc.deleted_at IS NULL
               LIMIT 1
             ) AS supervised_crew
      FROM users u
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
             u.email, u.username, u.is_active, u.status, u.created_at, u.updated_at, u.last_login_at,
             (SELECT phone_number FROM workers w WHERE w.user_id = u.id LIMIT 1) AS phone,
             (SELECT document_number FROM workers w WHERE w.user_id = u.id LIMIT 1) AS document_number,
             u.worker_id,
             (u.worker_id IS NOT NULL) AS has_worker_record,
             (
               SELECT STRING_AGG(DISTINCT r.name, ', ')
               FROM roles r
               JOIN user_roles ur ON r.id = ur.role_id
               WHERE ur.user_id = u.id
             ) AS role,
             COALESCE((
               SELECT array_agg(DISTINCT p.name)
               FROM permissions p
               JOIN role_permissions rp ON p.id = rp.permission_id
               JOIN user_roles ur ON ur.role_id = rp.role_id
               WHERE ur.user_id = u.id
             ), ARRAY[]::text[]) AS permissions,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'module', split_part(p.name, ':', 1),
                 'moduleLabel', INITCAP(REPLACE(split_part(p.name, ':', 1), '_', ' ')),
                 'access', split_part(p.name, ':', 2),
                 'accessLabel', CASE split_part(p.name, ':', 2) 
                   WHEN 'read' THEN 'Ver' 
                   WHEN 'write' THEN 'Editar' 
                   WHEN 'create' THEN 'Crear' 
                   WHEN 'delete' THEN 'Eliminar' 
                   WHEN 'manage' THEN 'Administrar' 
                   ELSE INITCAP(split_part(p.name, ':', 2)) 
                 END
               ))
               FROM permissions p
               JOIN role_permissions rp ON p.id = rp.permission_id
               JOIN user_roles ur ON ur.role_id = rp.role_id
               WHERE ur.user_id = u.id
             ), '[]'::json) AS permissions_by_module,
             json_build_object(
               'email_verified', true,
               'password_change_required', COALESCE(u.force_password_change, false),
               'failed_login_attempts', null,
               'active_sessions', (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = u.id AND revoked = false AND expires_at > NOW())
             ) AS security,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id', al.id,
                 'action', al.action,
                 'actionLabel', INITCAP(REPLACE(al.action, '_', ' ')),
                 'scope', CASE WHEN al.user_id = u.id THEN 'actor' ELSE 'target' END,
                 'description', CONCAT('Acción: ', al.action),
                 'created_at', al.created_at,
                 'actor_name', (SELECT CONCAT_WS(' ', first_name, last_name) FROM users actor WHERE actor.id = al.user_id)
               ))
               FROM (
                 SELECT * FROM audit_logs
                 WHERE (entity = 'users' AND entity_id = u.id) OR user_id = u.id
                 ORDER BY created_at DESC
                 LIMIT 10
               ) al
             ), '[]'::json) AS activity,
             CASE WHEN u.worker_id IS NOT NULL THEN
               json_build_object(
                 'id', u.worker_id,
                 'personal_id', (SELECT personal_id FROM workers WHERE id = u.worker_id),
                 'documentNumber', (SELECT document_number FROM workers WHERE id = u.worker_id),
                 'positionId', (SELECT position_id FROM workers WHERE id = u.worker_id),
                 'position', (
                   SELECT NULLIF(jp.name, 'No informado') FROM job_positions jp
                   JOIN workers w ON (jp.id = w.job_position_id OR jp.id = w.position_id)
                   WHERE w.id = u.worker_id
                   LIMIT 1
                 ),
                 'areaId', (SELECT area_id FROM workers WHERE id = u.worker_id),
                 'area_name', COALESCE(
                   (SELECT a.name FROM areas a JOIN workers w ON a.id = w.area_id WHERE w.id = u.worker_id LIMIT 1),
                   (SELECT d.name FROM departments d JOIN workers w ON d.id = w.internal_department_id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'departmentId', (SELECT internal_department_id FROM workers WHERE id = u.worker_id),
                 'department_name', COALESCE(
                   (SELECT d.name FROM departments d JOIN workers w ON d.id = w.internal_department_id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'company_name', (SELECT c.name FROM companies c JOIN workers w ON c.id = w.company_id WHERE w.id = u.worker_id LIMIT 1),
                 'branch_name', (SELECT p.name FROM projects p JOIN workers w ON p.id = w.branch_id WHERE w.id = u.worker_id LIMIT 1),
                 'workLocationId', (SELECT work_location_id FROM workers WHERE id = u.worker_id),
                 'work_location_name', COALESCE(
                   (SELECT wl.name FROM work_locations wl JOIN workers w ON w.work_location_id = wl.id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'crewId', (
                   SELECT cw.crew_id FROM crew_workers cw 
                   WHERE cw.worker_id = u.worker_id
                   LIMIT 1
                 ),
                 'crew_name', (
                   SELECT wc.name FROM work_crews wc 
                   JOIN crew_workers cw ON wc.id = cw.crew_id
                   WHERE cw.worker_id = u.worker_id AND wc.deleted_at IS NULL
                   LIMIT 1
                 ),
                 'supervisorId', (SELECT supervisor_id FROM workers WHERE id = u.worker_id),
                 'supervisor_name', (
                   SELECT CONCAT_WS(' ', s.first_name, s.last_name) 
                   FROM users s 
                   JOIN workers w ON s.id = w.user_id 
                   WHERE w.id = (SELECT supervisor_id FROM workers WHERE id = u.worker_id)
                   LIMIT 1
                 ),
                 'supervised_crew_name', (
                   SELECT wc.name FROM work_crews wc 
                   WHERE wc.supervisor_id = u.id AND wc.deleted_at IS NULL
                   LIMIT 1
                 ),
                 'status', (SELECT status FROM workers WHERE id = u.worker_id),
                 'hireDate', (SELECT hire_date FROM workers WHERE id = u.worker_id),
                 'contractType', (SELECT contract_type FROM workers WHERE id = u.worker_id)
               )
             ELSE NULL END AS worker,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id', wd.id,
                 'workerId', wd.worker_id,
                 'type', wd.document_type,
                 'name', wd.file_name,
                 'fileName', wd.file_name,
                 'mimeType', wd.mime_type,
                 'size', wd.size_bytes,
                 'createdAt', wd.uploaded_at,
                 'createdBy', (SELECT CONCAT_WS(' ', first_name, last_name) FROM users actor WHERE actor.id = wd.uploaded_by),
                 'url', wd.file_url
               ))
               FROM worker_documents wd
               WHERE wd.worker_id = u.worker_id AND wd.status != 'deleted'
             ), '[]'::json) AS documents,
             (
               SELECT json_build_object(
                 'id', wc.id,
                 'name', wc.name,
                 'work_location_name', wl.name
               )
               FROM work_crews wc
               JOIN work_locations wl ON wl.id = wc.work_location_id
               WHERE wc.supervisor_id = u.id AND wc.deleted_at IS NULL
               LIMIT 1
             ) AS supervised_crew
      FROM users u
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
    const {
      full_name,
      fullName,
      first_name,
      firstName,
      last_name,
      lastName,
      email,
      role,
      is_active,
      name,
      phone,
      status,
      requiresPasswordChange,
      document_number,
      documentNumber,
      birth_date,
      birthDate
    } = req.body;
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

    // Soporte para snake_case, camelCase y name/fullName desde UI.
    const fallbackName = name || full_name || fullName;
    const explicitFirst = first_name !== undefined ? first_name : firstName;
    const explicitLast = last_name !== undefined ? last_name : lastName;
    const nameParts = fallbackName ? String(fallbackName).trim().split(/\s+/) : [];
    const newFirst = explicitFirst !== undefined ? explicitFirst : (fallbackName ? nameParts[0] : undefined);
    const newLast = explicitLast !== undefined ? explicitLast : (fallbackName ? nameParts.slice(1).join(' ') : undefined);
    const finalFirst = newFirst !== undefined ? newFirst : oldData.first_name;
    const finalLast = newLast !== undefined ? newLast : oldData.last_name;

    if (newFirst !== undefined) { updateFields.push(`first_name = $${paramCount++}`); updateValues.push(newFirst); }
    if (newLast  !== undefined) { updateFields.push(`last_name = $${paramCount++}`);  updateValues.push(newLast); }
    if (fallbackName !== undefined || newFirst !== undefined || newLast !== undefined) {
      updateFields.push(`full_name = $${paramCount++}`);
      updateValues.push(fallbackName !== undefined ? String(fallbackName).trim() : [finalFirst, finalLast].filter(Boolean).join(' '));
    }

    if (email !== undefined) {
      const emailExists = await query('SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL', [email, id]);
      if (emailExists.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'El correo electrónico ya está en uso.' });
      }
      updateFields.push(`email = $${paramCount++}`);
      updateValues.push(email);
    }
    
    // Status mapping (status string or is_active boolean)
    const resolvedIsActive = is_active !== undefined ? is_active : (status === 'active' ? true : (status === 'inactive' || status === 'suspended' ? false : undefined));
    if (resolvedIsActive !== undefined) {
      updateFields.push(`is_active = $${paramCount++}`);
      updateValues.push(resolvedIsActive);
    }
    const resolvedStatus = status !== undefined ? status : (is_active === true ? 'active' : (is_active === false ? 'inactive' : undefined));
    if (resolvedStatus !== undefined) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(resolvedStatus);
    }

    // Requires password change mapping
    if (requiresPasswordChange !== undefined) {
      updateFields.push(`force_password_change = $${paramCount++}`);
      updateValues.push(requiresPasswordChange);
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

    const resolvedDocumentNumber = document_number !== undefined ? document_number : documentNumber;
    const resolvedBirthDate = birth_date !== undefined ? birth_date : birthDate;
    const workerUpdateFields = [];
    const workerUpdateValues = [];
    let workerParamCount = 1;

    if (phone !== undefined) {
      workerUpdateFields.push(`phone_number = $${workerParamCount++}`);
      workerUpdateValues.push(phone);
    }
    if (resolvedDocumentNumber !== undefined) {
      workerUpdateFields.push(`document_number = $${workerParamCount++}`);
      workerUpdateValues.push(resolvedDocumentNumber);
      workerUpdateFields.push(`personal_id = $${workerParamCount++}`);
      workerUpdateValues.push(resolvedDocumentNumber);
    }
    if (resolvedBirthDate !== undefined) {
      workerUpdateFields.push(`birth_date = $${workerParamCount++}`);
      workerUpdateValues.push(resolvedBirthDate || null);
    }
    if (newFirst !== undefined) {
      workerUpdateFields.push(`first_name = $${workerParamCount++}`);
      workerUpdateValues.push(newFirst);
    }
    if (newLast !== undefined) {
      workerUpdateFields.push(`paternal_last_name = $${workerParamCount++}`);
      workerUpdateValues.push(newLast);
    }

    if (workerUpdateFields.length > 0) {
      workerUpdateValues.push(id, tenantId);
      await query(
        `UPDATE workers SET ${workerUpdateFields.join(', ')}, updated_at = NOW()
         WHERE user_id = $${workerParamCount++}
           AND company_id = $${workerParamCount}
           AND deleted_at IS NULL`,
        workerUpdateValues
      );
    }

    await logAudit({
      userId: updaterId, companyId: tenantId, module: 'USERS', action: 'UPDATE',
      entity: 'users', entityId: id, oldData: { email: oldData.email }, newData: { email, role }, req
    });

    await query('COMMIT');

    const finalUserRes = await query(`
      SELECT u.id,
             COALESCE(NULLIF(u.full_name, ''), CONCAT_WS(' ', u.first_name, u.last_name)) AS full_name,
             u.first_name, u.last_name,
             (SELECT document_number FROM workers w WHERE w.user_id = u.id AND w.deleted_at IS NULL LIMIT 1) AS document_number,
             (SELECT birth_date FROM workers w WHERE w.user_id = u.id AND w.deleted_at IS NULL LIMIT 1) AS birth_date,
             (SELECT phone_number FROM workers w WHERE w.user_id = u.id AND w.deleted_at IS NULL LIMIT 1) AS phone,
             u.email, u.is_active, u.created_at, u.last_login_at,
             u.worker_id,
             (u.worker_id IS NOT NULL) AS has_worker_record,
             (
               SELECT STRING_AGG(DISTINCT r.name, ', ')
               FROM roles r
               JOIN user_roles ur ON r.id = ur.role_id
               WHERE ur.user_id = u.id
             ) AS role,
             (
               SELECT NULLIF(jp.name, 'No informado') FROM job_positions jp
               JOIN workers w ON (jp.id = w.job_position_id OR jp.id = w.position_id)
               WHERE w.user_id = u.id AND w.deleted_at IS NULL
               LIMIT 1
             ) AS position,
             COALESCE(
               (
                 SELECT wl.name FROM work_locations wl
                 JOIN workers w ON w.work_location_id = wl.id
                 WHERE w.user_id = u.id AND w.deleted_at IS NULL
                 LIMIT 1
               ),
               (
                 SELECT wl.name FROM work_locations wl
                 JOIN work_crews wc ON wc.work_location_id = wl.id
                 WHERE wc.supervisor_id = u.id AND wc.deleted_at IS NULL
                 LIMIT 1
               )
             ) AS project,
             CASE WHEN u.worker_id IS NOT NULL THEN
               json_build_object(
                 'id', u.worker_id,
                 'position', (
                   SELECT NULLIF(jp.name, 'No informado') FROM job_positions jp
                   JOIN workers w ON (jp.id = w.job_position_id OR jp.id = w.position_id)
                   WHERE w.id = u.worker_id
                   LIMIT 1
                 ),
                 'area_name', COALESCE(
                   (SELECT a.name FROM areas a JOIN workers w ON a.id = w.area_id WHERE w.id = u.worker_id LIMIT 1),
                   (SELECT d.name FROM departments d JOIN workers w ON d.id = w.internal_department_id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'work_location_name', COALESCE(
                   (SELECT wl.name FROM work_locations wl JOIN workers w ON w.work_location_id = wl.id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 )
               )
             ELSE NULL END AS worker,
             (
               SELECT json_build_object(
                 'id', wc.id,
                 'name', wc.name,
                 'work_location_name', wl.name
               )
               FROM work_crews wc
               JOIN work_locations wl ON wl.id = wc.work_location_id
               WHERE wc.supervisor_id = u.id AND wc.deleted_at IS NULL
               LIMIT 1
             ) AS supervised_crew
      FROM users u
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

exports.exportUsersPdf = async (req, res, next) => {
  try {
    const userFullName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : 'Sistema';
    const custom = req.body.customData || {};
    const columns = req.body.columns || custom.columns || [];
    const rows = req.body.rows || custom.rows || [];
    const reportTitle = req.body.reportTitle || custom.reportTitle || 'REPORTE DE USUARIOS';
    const documentType = req.body.documentType || custom.documentType || 'Documento interno';
    const filters = req.body.filters || custom.filters || {};
    const internalLabel = req.body.internalLabel || custom.internalLabel || 'F-RRHH-02';
    
    const companyConfig = await getCompanySettings(req.tenantId);
    
    const buffer = await generateCorporatePdf({
      companyConfig,
      reportTitle,
      documentType,
      internalLabel,
      filters,
      columns,
      rows,
      summary: req.body.summary || custom.summary || null,
      generatedBy: userFullName,
      generatedAt: new Date()
    });

    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'USERS', action: 'EXPORT_PDF', entity: 'users', req });

    const slug = reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filename = `${slug}-${moment().format('YYYY-MM-DD')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.exportUsersExcel = async (req, res, next) => {
  try {
    const custom = req.body.customData || {};
    const columns = req.body.columns || custom.columns || [];
    const rows = req.body.rows || custom.rows || [];

    const buffer = await excelExporter.generateDynamicExcel({ rows, columns, sheetName: 'Usuarios' });

    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'USERS', action: 'EXPORT_EXCEL', entity: 'users', req });

    res.setHeader('Content-Disposition', `attachment; filename="reporte-usuarios-${moment().format('YYYY-MM-DD')}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.linkWorker = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { workerId } = req.body;
    const tenantId = req.tenantId;

    await query('BEGIN');
    
    // Unlink any existing worker/user
    await query('UPDATE users SET worker_id = NULL WHERE worker_id = $1 AND company_id = $2', [workerId, tenantId]);
    await query('UPDATE workers SET user_id = NULL WHERE user_id = $1 AND company_id = $2', [id, tenantId]);

    // Link them together
    await query('UPDATE users SET worker_id = $1 WHERE id = $2 AND company_id = $3', [workerId, id, tenantId]);
    await query('UPDATE workers SET user_id = $1 WHERE id = $2 AND company_id = $3', [id, workerId, tenantId]);

    await logAudit({ userId: req.user.id, companyId: tenantId, module: 'USERS', action: 'LINK_WORKER', entity: 'users', entityId: id, newData: { workerId }, req });

    await query('COMMIT');
    res.json({ success: true, message: 'Trabajador vinculado exitosamente' });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    // Obtener los datos del usuario antes de resetear
    const userRes = await query(`
      SELECT u.id, u.email, u.worker_id, CONCAT_WS(' ', u.first_name, u.last_name) AS "fullName"
      FROM users u
      WHERE u.id = $1 AND u.company_id = $2 AND u.deleted_at IS NULL
    `, [id, tenantId]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    const targetUser = userRes.rows[0];

    // Generate random 8-character password
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const result = await query(
      'UPDATE users SET password_hash = $1, force_password_change = true, updated_at = NOW() WHERE id = $2 AND company_id = $3 RETURNING email',
      [hashedPassword, id, tenantId]
    );

    await logAudit({ userId: req.user.id, companyId: tenantId, module: 'USERS', action: 'RESET_PASSWORD', entity: 'users', entityId: id, req });

    let generatedDocument = null;
    // Si tiene worker_id, generamos constancia en PDF
    if (targetUser.worker_id) {
      try {
        const actorName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : 'Sistema';
        const pdfBuffer = await pdfGenerator.generatePasswordResetPdf(targetUser, tempPassword, actorName);
        
        const fileName = `Credenciales temporales - ${targetUser.fullName}.pdf`;
        const filePath = `${tenantId}/${targetUser.worker_id}/${Date.now()}_credenciales.pdf`;
        
        const fileObj = {
          buffer: pdfBuffer,
          mimetype: 'application/pdf'
        };

        const publicUrl = await uploadFile(fileObj, 'worker-documents', filePath);

        const docRes = await query(`
          INSERT INTO worker_documents (worker_id, company_id, document_type, file_name, file_url, file_path, mime_type, size_bytes, status, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, file_name, file_url
        `, [
          targetUser.worker_id,
          tenantId,
          'CONSTANCIA_PASSWORD',
          fileName,
          publicUrl,
          filePath,
          'application/pdf',
          pdfBuffer.length,
          'active',
          req.user.id
        ]);
        generatedDocument = docRes.rows[0];
      } catch (pdfErr) {
        console.error('Error generando constancia PDF:', pdfErr);
        // No bloqueamos el reseteo si falla el PDF
      }
    }

    res.json({ 
      success: true, 
      temporaryPassword: tempPassword,
      requiresPasswordChange: true,
      generatedAt: new Date().toISOString(),
      document: generatedDocument ? {
        id: generatedDocument.id,
        name: generatedDocument.file_name,
        url: generatedDocument.file_url
      } : null
    });
  } catch (error) {
    next(error);
  }
};

exports.exportUserPdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    // Reutilizamos la lógica del GET /api/users/:id pero desde Node en lugar de HTTP call
    const result = await query(`
      SELECT u.id,
             CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.email, u.username,
             (SELECT phone_number FROM workers w WHERE w.user_id = u.id LIMIT 1) AS phone,
             (SELECT document_number FROM workers w WHERE w.user_id = u.id LIMIT 1) AS document_number,
             (
               SELECT STRING_AGG(DISTINCT r.name, ', ')
               FROM roles r
               JOIN user_roles ur ON r.id = ur.role_id
               WHERE ur.user_id = u.id
             ) AS role,
             CASE WHEN u.worker_id IS NOT NULL THEN
               json_build_object(
                 'id', u.worker_id,
                 'position', (
                   SELECT NULLIF(jp.name, 'No informado') FROM job_positions jp
                   JOIN workers w ON (jp.id = w.job_position_id OR jp.id = w.position_id)
                   WHERE w.id = u.worker_id
                   LIMIT 1
                 ),
                 'area_name', COALESCE(
                   (SELECT a.name FROM areas a JOIN workers w ON a.id = w.area_id WHERE w.id = u.worker_id LIMIT 1),
                   (SELECT d.name FROM departments d JOIN workers w ON d.id = w.internal_department_id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'department_name', COALESCE(
                   (SELECT d.name FROM departments d JOIN workers w ON d.id = w.internal_department_id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'company_name', (SELECT c.name FROM companies c JOIN workers w ON c.id = w.company_id WHERE w.id = u.worker_id LIMIT 1),
                 'branch_name', (SELECT p.name FROM projects p JOIN workers w ON p.id = w.branch_id WHERE w.id = u.worker_id LIMIT 1),
                 'work_location_name', COALESCE(
                   (SELECT wl.name FROM work_locations wl JOIN workers w ON w.work_location_id = wl.id WHERE w.id = u.worker_id LIMIT 1),
                   'No informado'
                 ),
                 'crew_name', (
                   SELECT wc.name FROM work_crews wc 
                   JOIN crew_workers cw ON wc.id = cw.crew_id
                   WHERE cw.worker_id = u.worker_id AND wc.deleted_at IS NULL
                   LIMIT 1
                 ),
                 'supervised_crew_name', (
                   SELECT wc.name FROM work_crews wc 
                   WHERE wc.supervisor_id = u.id AND wc.deleted_at IS NULL
                   LIMIT 1
                 ),
                 'status', (SELECT status FROM workers WHERE id = u.worker_id)
               )
             ELSE NULL END AS worker
      FROM users u
      WHERE u.id = $1 AND u.company_id = $2 AND u.deleted_at IS NULL
    `, [id, tenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const userData = result.rows[0];
    
    const rows = [
      { campo: 'Nombre Completo', valor: userData.full_name },
      { campo: 'Email', valor: userData.email },
      { campo: 'Usuario', valor: userData.username },
      { campo: 'Teléfono', valor: userData.phone || 'No especificado' },
      { campo: 'Documento', valor: userData.document_number || 'No especificado' },
      { campo: 'Roles', valor: userData.role || 'No especificado' }
    ];

    if (userData.worker) {
      rows.push({ campo: '', valor: '' }); // Espaciador
      rows.push({ campo: '--- FICHA LABORAL ---', valor: '----------------------------------------' });
      rows.push({ campo: 'Empresa', valor: userData.worker.company_name || '-' });
      rows.push({ campo: 'Sede', valor: userData.worker.branch_name || '-' });
      rows.push({ campo: 'Departamento', valor: userData.worker.department_name || '-' });
      rows.push({ campo: 'Área', valor: userData.worker.area_name || '-' });
      rows.push({ campo: 'Cargo', valor: userData.worker.position || '-' });
      rows.push({ campo: 'Obra', valor: userData.worker.work_location_name || '-' });
      if (userData.worker.crew_name) {
        rows.push({ campo: 'Cuadrilla', valor: userData.worker.crew_name });
      }
      if (userData.worker.supervised_crew_name) {
        rows.push({ campo: 'Supervisa cuadrilla', valor: userData.worker.supervised_crew_name });
      }
      rows.push({ campo: 'Estado', valor: userData.worker.status || '-' });
    }

    const columns = [
      { key: 'campo', label: 'CAMPO / SECCIÓN', widthRatio: 0.35 },
      { key: 'valor', label: 'DETALLE', widthRatio: 0.65 }
    ];

    const companyConfig = await getCompanySettings(tenantId);
    const userFullName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : 'Sistema';

    const pdfBuffer = await generateCorporatePdf({
      companyConfig,
      reportTitle: `PERFIL DE USUARIO: ${userData.full_name.toUpperCase()}`,
      documentType: 'Perfil de Usuario',
      internalLabel: 'F-RRHH-USR',
      columns,
      rows,
      summary: { 'ID Sistema': userData.id.split('-')[0] },
      generatedBy: userFullName
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="perfil_usuario_${id}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

const DEFAULT_UI_PREFERENCES = {
  theme: 'light',
  language: 'es',
  sidebarCollapsed: false,
  density: 'comfortable',
  accentColor: 'green'
};

const ALLOWED_UI_PREFERENCE_KEYS = ['theme', 'language', 'sidebarCollapsed', 'density', 'accentColor'];

function normalizeUiPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return { ...DEFAULT_UI_PREFERENCES };
  }

  return {
    ...DEFAULT_UI_PREFERENCES,
    ...preferences
  };
}

function getStoredUiPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return {};
  }

  const allowedPreferences = {};
  for (const key of ALLOWED_UI_PREFERENCE_KEYS) {
    if (preferences[key] !== undefined) {
      allowedPreferences[key] = preferences[key];
    }
  }

  return Object.keys(allowedPreferences).length > 0
    ? normalizeUiPreferences(allowedPreferences)
    : {};
}

function sendObjectContract(res, data) {
  const objectData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  res.json({
    success: true,
    data: objectData,
    ...objectData
  });
}

function isMissingPreferencesColumnError(error) {
  return error?.code === '42703' && String(error.message || '').includes('ui_preferences');
}

function validateUiPreferenceUpdates(updates) {
  for (const key of Object.keys(updates)) {
    if (!ALLOWED_UI_PREFERENCE_KEYS.includes(key)) {
      return {
        statusCode: 400,
        body: {
          success: false,
          message: `Propiedad no permitida: ${key}`,
          error_code: 'INVALID_PREFERENCE_KEY'
        }
      };
    }
  }

  if (updates.theme !== undefined && !['light', 'dark', 'system'].includes(updates.theme)) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'El tema debe ser light, dark o system',
        error_code: 'INVALID_THEME'
      }
    };
  }

  if (updates.density !== undefined && !['comfortable', 'compact'].includes(updates.density)) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'La densidad debe ser comfortable o compact',
        error_code: 'INVALID_DENSITY'
      }
    };
  }

  if (updates.accentColor !== undefined && !['green', 'blue', 'purple', 'gray'].includes(updates.accentColor)) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'El color de acento debe ser green, blue, purple o gray',
        error_code: 'INVALID_ACCENT_COLOR'
      }
    };
  }

  if (updates.language !== undefined && !['es', 'en'].includes(String(updates.language))) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'El idioma debe ser es o en',
        error_code: 'INVALID_LANGUAGE'
      }
    };
  }

  if (updates.sidebarCollapsed !== undefined && typeof updates.sidebarCollapsed !== 'boolean') {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'sidebarCollapsed debe ser booleano',
        error_code: 'INVALID_SIDEBAR_COLLAPSED'
      }
    };
  }

  return null;
}

exports.getPreferences = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
    }

    const userId = req.user.id;
    const userRes = await query('SELECT ui_preferences FROM users WHERE id = $1', [userId]);
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    sendObjectContract(res, getStoredUiPreferences(userRes.rows[0].ui_preferences));
  } catch (error) {
    if (isMissingPreferencesColumnError(error)) {
      return sendObjectContract(res, {});
    }

    next(error);
  }
};

exports.updatePreferences = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
    }

    const userId = req.user.id;
    const tenantId = req.tenantId;

    // Obtener preferencias actuales de la base de datos
    const userRes = await query('SELECT ui_preferences FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const currentPreferences = normalizeUiPreferences(userRes.rows[0].ui_preferences);

    const updates = req.body || {};

    const validationError = validateUiPreferenceUpdates(updates);
    if (validationError) {
      return res.status(validationError.statusCode).json(validationError.body);
    }

    // Combinar de forma segura
    const mergedPreferences = {
      ...currentPreferences,
      ...updates
    };

    // Actualizar base de datos
    await query('UPDATE users SET ui_preferences = $1, updated_at = NOW() WHERE id = $2', [
      JSON.stringify(mergedPreferences),
      userId
    ]);

    // Registrar auditoría con USER_UPDATED_UI_PREFERENCES
    await logAudit({
      userId,
      companyId: tenantId,
      module: 'USERS',
      action: 'USER_UPDATED_UI_PREFERENCES',
      entity: 'users',
      entityId: userId,
      oldData: currentPreferences,
      newData: mergedPreferences,
      req
    });

    logger.logChange('USERS', 'Preferencias de usuario actualizadas', { userId, updates });

    sendObjectContract(res, mergedPreferences);
  } catch (error) {
    if (isMissingPreferencesColumnError(error)) {
      return sendObjectContract(res, {});
    }

    next(error);
  }
};
