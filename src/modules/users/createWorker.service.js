const { query, withTransaction } = require('../../config/database');
const { insertReturning } = require('../../utils/db.util');
const { fetchDniData } = require('../../utils/dni.util');
const { suggestAvailableUsernames, generateCorporateEmail } = require('../../utils/credentials.util');
const { generateTemporaryPassword, hashPassword } = require('../../utils/password.util');

const CRITICAL_ROLE_CODES = new Set(['ADMIN', 'GERENCIA']);

function createHttpError(statusCode, errorCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  return error;
}

async function validateSelectedRole(db, roleId, companyId, creatorRoles = []) {
  if (!roleId) return null;

  const roleRes = await db.query(
    `SELECT id, name, code
     FROM roles
     WHERE id = $1
       AND (company_id = $2 OR company_id IS NULL)
       AND COALESCE(is_active, TRUE) = TRUE
       AND deleted_at IS NULL
     ORDER BY CASE WHEN company_id = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [roleId, companyId]
  );

  if (roleRes.rowCount === 0) {
    throw createHttpError(422, 'ROLE_NOT_FOUND', 'El rol especificado no existe o no esta activo.');
  }

  const role = roleRes.rows[0];
  const roleCode = String(role.code || role.name).toUpperCase();
  if (!creatorRoles.includes('ADMIN') && CRITICAL_ROLE_CODES.has(roleCode)) {
    throw createHttpError(403, 'ROLE_ASSIGNMENT_FORBIDDEN', 'No tienes permiso para asignar este rol.');
  }

  return role;
}

async function validateWorkerRelations(db, data, companyId, creatorRoles = []) {
  // Check Area
  if (data.area_id) {
    const areaRes = await db.query('SELECT 1 FROM areas WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL', [data.area_id, companyId]);
    if (areaRes.rowCount === 0) throw createHttpError(422, 'INVALID_AREA', 'El área especificada no existe.');
  }

  // Check Position & get default role
  let roleId = null;
  if (data.job_position_id) {
    const posRes = await db.query(
      `SELECT area_id, default_role_id
       FROM job_positions
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE`,
      [data.job_position_id, companyId]
    );
    if (posRes.rowCount === 0) throw createHttpError(422, 'JOB_POSITION_NOT_FOUND', 'El puesto especificado no existe.');
    
    const pos = posRes.rows[0];
    if (pos.area_id !== data.area_id) {
      throw createHttpError(422, 'INVALID_JOB_POSITION_AREA', 'El puesto seleccionado no pertenece al área indicada.');
    }
    roleId = pos.default_role_id;
  }

  if (data.role_id) {
    const selectedRole = await validateSelectedRole(db, data.role_id, companyId, creatorRoles);
    roleId = selectedRole.id;
  }

  // Fallback Role
  if (!roleId) {
    const fallbackRole = await db.query(
      `SELECT id
       FROM roles
       WHERE (name = $1 OR code = $1)
         AND (company_id = $2 OR company_id IS NULL)
         AND COALESCE(is_active, TRUE) = TRUE
         AND deleted_at IS NULL
       ORDER BY CASE WHEN company_id = $2 THEN 0 ELSE 1 END
       LIMIT 1`,
      ['TRABAJADOR', companyId]
    );
    if (fallbackRole.rowCount > 0) roleId = fallbackRole.rows[0].id;
  }

  // Ubigeo validation
  if (data.address || data.department_id || data.province_id || data.district_id) {
    if (!data.department_id || !data.province_id || !data.district_id) {
      throw createHttpError(422, 'VALIDATION_ERROR', 'Departamento, provincia y distrito son obligatorios si se provee dirección.');
    }
    const depRes = await db.query('SELECT 1 FROM departments WHERE id = $1', [data.department_id]);
    if (depRes.rowCount === 0) throw createHttpError(422, 'DEPARTMENT_NOT_FOUND', 'El departamento no existe.');
    
    const provRes = await db.query('SELECT department_id FROM provinces WHERE id = $1', [data.province_id]);
    if (provRes.rowCount === 0) throw createHttpError(422, 'PROVINCE_NOT_FOUND', 'La provincia no existe.');
    if (provRes.rows[0].department_id !== data.department_id) throw createHttpError(422, 'INVALID_PROVINCE_DEPARTMENT', 'La provincia no pertenece al departamento seleccionado.');
    
    const distRes = await db.query('SELECT province_id FROM districts WHERE id = $1', [data.district_id]);
    if (distRes.rowCount === 0) throw createHttpError(422, 'DISTRICT_NOT_FOUND', 'El distrito no existe.');
    if (distRes.rows[0].province_id !== data.province_id) throw createHttpError(422, 'INVALID_DISTRICT_PROVINCE', 'El distrito no pertenece a la provincia seleccionada.');
  }

  return { roleId };
}

async function createWorkerTransaction(payload, companyId, creatorId, creatorRoles = []) {
  // 1. Fetch DNI
  let dniData;
  try {
    dniData = await fetchDniData(payload.dni);
  } catch (err) {
    throw createHttpError(422, 'INVALID_DNI', err.message);
  }

  const firstName = payload.first_name || dniData.nombres;
  const lastName = payload.last_name || `${dniData.apellido_paterno} ${dniData.apellido_materno}`;

  // 2. Transaction
  return await withTransaction(async (db) => {
    // Check DNI
    const dniExists = await db.query('SELECT 1 FROM workers WHERE document_number = $1 AND company_id = $2 AND deleted_at IS NULL', [payload.dni, companyId]);
    if (dniExists.rowCount > 0) throw createHttpError(409, 'DNI_ALREADY_EXISTS', 'El DNI ya está registrado en esta empresa.');

    // Validate and get Role
    const { roleId } = await validateWorkerRelations(db, payload, companyId, creatorRoles);

    // Get Company Email Domain
    const compRes = await db.query('SELECT email_domain FROM company_settings WHERE company_id = $1', [companyId]);
    const emailDomain = compRes.rows[0]?.email_domain || 'empresa.com';

    // Generate Username
    const suggestions = await suggestAvailableUsernames(
      { firstName, paternalLastName: dniData.apellido_paterno || lastName, maternalLastName: dniData.apellido_materno },
      async (candidate) => {
        const u = await db.query('SELECT 1 FROM users WHERE username = $1 AND company_id = $2', [candidate, companyId]);
        return u.rowCount > 0;
      },
      1
    );
    const username = suggestions.username;
    
    // Check Email
    const corporateEmail = payload.email || generateCorporateEmail(username, emailDomain);
    const emailExists = await db.query('SELECT 1 FROM users WHERE email = $1 AND company_id = $2', [corporateEmail, companyId]);
    if (emailExists.rowCount > 0) throw createHttpError(409, 'EMAIL_ALREADY_EXISTS', 'El correo ya está registrado.');

    // Passwords
    const temporaryPassword = generateTemporaryPassword('Demo2026!');
    const passwordHash = await hashPassword(temporaryPassword);

    // Create User
    const user = await insertReturning(db, 'users', {
      company_id: companyId,
      username,
      email: corporateEmail,
      password_hash: passwordHash,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      status: 'active',
      is_active: true,
      force_password_change: true,
      created_by: creatorId
    });

    if (roleId) {
      await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, roleId]);
    }

    // Create Worker
    const worker = await insertReturning(db, 'workers', {
      company_id: companyId,
      user_id: user.id,
      document_type: 'DNI',
      document_number: payload.dni,
      personal_id: payload.dni,
      first_name: firstName,
      paternal_last_name: dniData.apellido_paterno || null,
      maternal_last_name: dniData.apellido_materno || null,
      phone_number: payload.phone || null,
      area_id: payload.area_id || null,
      position_id: payload.job_position_id || null,
      job_position_id: payload.job_position_id || null,
      department_id: payload.department_id || null,
      province_id: payload.province_id || null,
      district_id: payload.district_id || null,
      address: payload.address || null,
      hire_date: payload.start_date || new Date(),
      start_date: payload.start_date || new Date(),
      status: 'ACTIVE',
      created_by: creatorId
    });

    // Worker Contract (Planilla)
    if (payload.contract_type) {
      const agreedSalary = Number(payload.agreed_salary ?? payload.salary ?? payload.base_salary ?? 0);

      if (!Number.isFinite(agreedSalary) || agreedSalary < 0) {
        throw createHttpError(422, 'INVALID_CONTRACT_SALARY', 'El sueldo del contrato debe ser un numero mayor o igual a 0.');
      }

      await insertReturning(db, 'worker_contracts', {
        worker_id: worker.id,
        company_id: companyId,
        contract_type: payload.contract_type,
        start_date: payload.start_date || new Date(),
        end_date: payload.end_date || null,
        agreed_salary: agreedSalary,
        status: 'active',
        created_by: creatorId
      });
    }

    const summaryRes = await db.query(
      `SELECT w.id AS worker_id,
              CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name) AS worker_full_name,
              w.document_number AS dni,
              a.name AS area_name,
              jp.name AS job_position_name,
              u.id AS user_id,
              u.username,
              u.email,
              r.code AS role_code,
              r.name AS role_name
       FROM workers w
       JOIN users u ON u.id = w.user_id
       LEFT JOIN areas a ON a.id = w.area_id
       LEFT JOIN job_positions jp ON jp.id = w.job_position_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE w.id = $1
       LIMIT 1`,
      [worker.id]
    );
    const summary = summaryRes.rows[0] || {};

    return {
      worker: {
        id: summary.worker_id || worker.id,
        full_name: summary.worker_full_name || `${firstName} ${lastName}`,
        dni: summary.dni || payload.dni,
        area: summary.area_name || null,
        job_position: summary.job_position_name || null
      },
      user: {
        id: summary.user_id || user.id,
        username: summary.username || user.username,
        email: summary.email || user.email,
        role: summary.role_code || summary.role_name || null,
        temporary_password: true
      }
    };
  });
}

module.exports = {
  createWorkerTransaction
};
