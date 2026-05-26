const { withTransaction } = require('../../config/database');
const { insertReturning } = require('../../utils/db.util');
const { fetchDniData } = require('../../utils/dni.util');
const { suggestAvailableUsernames, generateCorporateEmail } = require('../../utils/credentials.util');
const { generateTemporaryPassword, hashPassword } = require('../../utils/password.util');
const {
  validateGeography,
  validateLaborAssignment,
  assignDefaultRoleToUser
} = require('../../shared/services/labor-assignment.service');

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

async function resolveWorkerRole(db, data, companyId, creatorRoles = []) {
  const { defaultRoleId } = await validateLaborAssignment(db, {
    ...data,
    position_id: data.position_id || data.job_position_id
  }, companyId);

  if (data.role_id) {
    const selectedRole = await validateSelectedRole(db, data.role_id, companyId, creatorRoles);
    return selectedRole.id;
  }

  if (defaultRoleId) return defaultRoleId;

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

  return fallbackRole.rows[0]?.id || null;
}

async function validateWorkerGeography(db, data) {
  const geographicDepartmentId = data.geographic_department_id || data.department_id;
  const geographicProvinceId = data.geographic_province_id || data.province_id;
  const geographicDistrictId = data.geographic_district_id || data.district_id;

  if (!(data.address || geographicDepartmentId || geographicProvinceId || geographicDistrictId)) return;

  if (!geographicDepartmentId || !geographicProvinceId || !geographicDistrictId) {
    throw createHttpError(422, 'VALIDATION_ERROR', 'Departamento, provincia y distrito son obligatorios si se provee direccion.');
  }

  await validateGeography(db, geographicDepartmentId, geographicProvinceId, geographicDistrictId);
}

async function createWorkerTransaction(payload, companyId, creatorId, creatorRoles = []) {
  let dniData;
  try {
    dniData = await fetchDniData(payload.dni);
  } catch (err) {
    throw createHttpError(422, 'INVALID_DNI', err.message);
  }

  const firstName = payload.first_name || dniData.nombres;
  const lastName = payload.last_name || `${dniData.apellido_paterno} ${dniData.apellido_materno}`;

  return withTransaction(async (db) => {
    const dniExists = await db.query(
      'SELECT 1 FROM workers WHERE document_number = $1 AND company_id = $2 AND deleted_at IS NULL',
      [payload.dni, companyId]
    );
    if (dniExists.rowCount > 0) {
      throw createHttpError(409, 'DNI_ALREADY_EXISTS', 'El DNI ya esta registrado en esta empresa.');
    }

    const roleId = await resolveWorkerRole(db, payload, companyId, creatorRoles);
    await validateWorkerGeography(db, payload);

    const compRes = await db.query('SELECT email_domain FROM company_settings WHERE company_id = $1', [companyId]);
    const emailDomain = compRes.rows[0]?.email_domain || 'empresa.com';

    const suggestions = await suggestAvailableUsernames(
      { firstName, paternalLastName: dniData.apellido_paterno || lastName, maternalLastName: dniData.apellido_materno },
      async (candidate) => {
        const u = await db.query('SELECT 1 FROM users WHERE username = $1 AND company_id = $2', [candidate, companyId]);
        return u.rowCount > 0;
      },
      1
    );
    const username = suggestions.username;

    const corporateEmail = payload.email || generateCorporateEmail(username, emailDomain);
    const emailExists = await db.query('SELECT 1 FROM users WHERE email = $1 AND company_id = $2', [corporateEmail, companyId]);
    if (emailExists.rowCount > 0) {
      throw createHttpError(409, 'EMAIL_ALREADY_EXISTS', 'El correo ya esta registrado.');
    }

    const temporaryPassword = generateTemporaryPassword('Demo2026!');
    const passwordHash = await hashPassword(temporaryPassword);

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

    await assignDefaultRoleToUser(db, user.id, roleId);

    const positionId = payload.position_id || payload.job_position_id || null;
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
      sede_id: payload.sede_id || null,
      internal_department_id: payload.internal_department_id || null,
      area_id: payload.area_id || null,
      position_id: positionId,
      job_position_id: positionId,
      work_location_id: payload.work_location_id || null,
      department_id: payload.geographic_department_id || payload.department_id || null,
      province_id: payload.geographic_province_id || payload.province_id || null,
      district_id: payload.geographic_district_id || payload.district_id || null,
      address: payload.address || null,
      employment_type: payload.employment_type || payload.contract_type || null,
      hire_date: payload.start_date || new Date(),
      start_date: payload.start_date || new Date(),
      status: 'ACTIVE',
      created_by: creatorId
    });

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
              d.name AS internal_department_name,
              a.name AS area_name,
              jp.name AS job_position_name,
              wl.name AS work_location_name,
              u.id AS user_id,
              u.username,
              u.email,
              r.code AS role_code,
              r.name AS role_name
       FROM workers w
       JOIN users u ON u.id = w.user_id
       LEFT JOIN departments d ON d.id = w.internal_department_id
       LEFT JOIN areas a ON a.id = w.area_id
       LEFT JOIN job_positions jp ON jp.id = w.job_position_id
       LEFT JOIN work_locations wl ON wl.id = w.work_location_id
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
        internal_department: summary.internal_department_name || null,
        area: summary.area_name || null,
        job_position: summary.job_position_name || null,
        work_location: summary.work_location_name || null
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
