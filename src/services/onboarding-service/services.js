const { query, withTransaction } = require('../../config/database');
const { validateOnboardingPayload, WORKER_TYPES, COST_CENTERS } = require('./validators');
const { suggestAvailableUsernames, generateCorporateEmail } = require('../../utils/credentials.util');
const { validatePasswordStrength, generateTemporaryPassword, hashPassword } = require('../../utils/password.util');
const { insertReturning, updateReturning } = require('../../utils/db.util');
const { logAuditEvent } = require('../../utils/audit.util');
const contractService = require('../contract-service/services');
const workerRepository = require('../../repositories/worker.repository');
const {
  firstPresent,
  normalizeCompleteProfilePayload,
  buildWorkerPersistenceData
} = require('../../normalizers/worker-payload.normalizer');
const {
  mapCompleteProfileGetResponse,
  mapCompleteProfilePutResponse,
  buildPendingDocumentNumber
} = require('../../mappers/worker.mapper');
const { assertValidWorkerId, assertValidUserId, isValidUUID } = require('../../utils/uuid.util');

const ALLOWED_ACCESS_ROLES = new Set(['ADMIN', 'RRHH', 'SUPERVISOR', 'TRABAJADOR']);
// ALLOWED_ACCESS_ROLES is obsolete for onboarding, custom roles are allowed.

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) {
    error.errors = errors;
  }
  return error;
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function getRequestMeta(req) {
  return {
    ip: req.ip || req.headers?.['x-forwarded-for'] || null,
    user_agent: req.headers?.['user-agent'] || null
  };
}

function assertAuthorized(req) {
  const roles = req.user?.roles || [];
  if (!roles.includes('ADMIN') && !roles.includes('RRHH')) {
    throw createHttpError(403, 'INSUFFICIENT_PERMISSIONS', 'Solo ADMIN y RRHH pueden crear colaboradores.');
  }
}

function assertTenant(companyId, tenantId) {
  if (!tenantId || !companyId || companyId !== tenantId) {
    throw createHttpError(403, 'TENANT_MISMATCH', 'La empresa enviada no coincide con el tenant autenticado.', [
      { field: 'laborData.companyId', message: 'No se permite crear colaboradores en otra empresa.' }
    ]);
  }
}

async function getCompanyConfig(companyId, db = { query }) {
  const result = await db.query(`
    SELECT c.id AS company_id,
           c.name AS company_name,
           c.ruc AS company_ruc,
           cs.*
    FROM companies c
    LEFT JOIN company_settings cs ON cs.company_id = c.id
    WHERE c.id = $1
      AND c.deleted_at IS NULL
    LIMIT 1
  `, [companyId]);

  return result.rows[0] || null;
}

function resolveEmailDomain(companyConfig) {
  if (!companyConfig) {
    return null;
  }

  if (companyConfig.email_domain) {
    return String(companyConfig.email_domain).trim().toLowerCase().replace(/^@/, '');
  }

  if (companyConfig.correo_corporativo && String(companyConfig.correo_corporativo).includes('@')) {
    return String(companyConfig.correo_corporativo).split('@')[1].trim().toLowerCase();
  }

  return null;
}

async function usernameExists(companyId, username, excludeUserId = null, db = { query }) {
  if (!username) {
    return false;
  }
  return workerRepository.existsUsername(companyId, username, excludeUserId, db);
}

async function emailExists(companyId, email, excludeUserId = null, db = { query }) {
  return workerRepository.existsEmail(companyId, email, excludeUserId, db);
}

async function assertDniIsAvailable(companyId, dni, excludeWorkerId = null, db = { query }) {
  if (await workerRepository.existsDni(companyId, dni, excludeWorkerId, db)) {
    throw createHttpError(409, 'DNI_ALREADY_EXISTS', 'El DNI ya se encuentra registrado.', [
      { field: 'personalData.dni', message: 'El DNI ya se encuentra registrado en otro trabajador.' }
    ]);
  }
}

async function assertUserCredentialsAvailable(companyId, accessData, excludeUserId = null, db = { query }) {
  if (!accessData?.createAccess) {
    return;
  }

  const requestedUsername = accessData.username;
  const requestedCorporateEmail = accessData.corporateEmail || accessData.corporate_email;

  if (requestedUsername && await usernameExists(companyId, requestedUsername, excludeUserId, db)) {
    throw createHttpError(409, 'USERNAME_ALREADY_EXISTS', 'El username ya se encuentra registrado.', [
      { field: 'accessData.username', message: 'El username ya se encuentra registrado en otro usuario.' }
    ]);
  }

  if (requestedCorporateEmail && await emailExists(companyId, requestedCorporateEmail, excludeUserId, db)) {
    throw createHttpError(409, 'EMAIL_ALREADY_EXISTS', 'El correo corporativo ya se encuentra registrado.', [
      { field: 'accessData.corporateEmail', message: 'El correo corporativo ya se encuentra registrado en otro usuario.' }
    ]);
  }
}

async function resolveRole(roleInput, companyId, db = { query }) {
  const input = String(roleInput || 'TRABAJADOR').trim();
  
  let result;
  
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) {
    // Es un UUID
    result = await db.query(`
      SELECT id, name, code
      FROM roles
      WHERE id = $1
        AND (company_id = $2 OR company_id IS NULL)
        AND deleted_at IS NULL
        AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1
    `, [input, companyId]);
  } else {
    // Es un código o nombre
    const normalized = input.toUpperCase();
    result = await db.query(`
      SELECT id, name, code
      FROM roles
      WHERE (UPPER(code) = $1 OR UPPER(name) = $1)
        AND (company_id = $2 OR company_id IS NULL)
        AND deleted_at IS NULL
        AND COALESCE(is_active, TRUE) = TRUE
      ORDER BY CASE WHEN company_id = $2 THEN 0 ELSE 1 END, created_at ASC NULLS LAST
      LIMIT 1
    `, [normalized, companyId]);
  }

  if (!result.rows[0]) {
    throw createHttpError(422, 'INVALID_ROLE', 'El rol especificado no existe en la empresa o no está activo.', [
      { field: 'accessData.role', message: 'El rol especificado no existe o no está activo.' }
    ]);
  }

  return result.rows[0];
}

async function resolveContractType(contractType, companyId, db = { query }) {
  if (!contractType) {
    return null;
  }

  const value = String(contractType).trim();
  const result = await db.query(`
    SELECT id, name
    FROM contract_types
    WHERE company_id = $1
      AND (id::text = $2 OR LOWER(name) = LOWER($2))
    ORDER BY created_at ASC
    LIMIT 1
  `, [companyId, value]);

  return result.rows[0] || null;
}

async function suggestCredentials(payload, req) {
  const companyId = payload.company_id || payload.companyId || req.tenantId;
  assertTenant(companyId, req.tenantId);

  const firstName = payload.first_name || payload.firstName;
  const paternalLastName = payload.paternal_last_name || payload.paternalLastName;
  const maternalLastName = payload.maternal_last_name || payload.maternalLastName;

  if (!firstName || !paternalLastName) {
    throw createHttpError(422, 'VALIDATION_FAILED', 'Nombre y apellido paterno son obligatorios.', [
      { field: 'first_name', message: 'El nombre es obligatorio.' },
      { field: 'paternal_last_name', message: 'El apellido paterno es obligatorio.' }
    ]);
  }

  const companyConfig = await getCompanyConfig(companyId);
  const emailDomain = resolveEmailDomain(companyConfig);
  if (!emailDomain) {
    throw createHttpError(422, 'COMPANY_DOMAIN_NOT_FOUND', 'La empresa no tiene un dominio corporativo configurado.');
  }

  const suggestions = await suggestAvailableUsernames(
    { firstName, paternalLastName, maternalLastName },
    (candidate) => usernameExists(companyId, candidate),
    5
  );

  // Generar contraseña temporal criptográficamente segura.
  // Solo se devuelve en esta respuesta; NO se persiste como texto plano.
  const temporaryPassword = generateTemporaryPassword();

  return {
    // Campos camelCase (estándar)
    username: suggestions.username,
    corporateEmail: generateCorporateEmail(suggestions.username, emailDomain),
    temporaryPassword,
    forcePasswordChange: true,
    alternatives: suggestions.username_suggestions ?? [],

    // Aliases snake_case para compatibilidad con normalizadores anteriores
    username_suggestions: suggestions.username_suggestions ?? [],
    corporate_email: generateCorporateEmail(suggestions.username, emailDomain),
    temporary_password: temporaryPassword,
    force_password_change: true,
  };
}


async function createWorkerRecord(db, payload, creatorId) {
  return workerRepository.createWorker(
    buildWorkerPersistenceData(payload, {
      userId: null,
      creatorId,
      onboardingStatus: 'worker_created'
    }),
    db
  );
}

async function updateWorkerRecord(db, workerId, payload, options = {}) {
  const persistenceData = buildWorkerPersistenceData(payload, {
    existingWorker: options.existingWorker || null,
    preserveExisting: options.preserveExisting === true,
    userId: options.userId
  });
  const laborData = payload.laborData || {};

  if (options.preserveExisting === true && firstPresent(laborData.status, laborData.employment_status) === null) {
    delete persistenceData.status;
    delete persistenceData.employment_status;
    delete persistenceData.is_active;
  }

  return workerRepository.updateWorker(workerId, {
    ...persistenceData,
    updated_at: new Date()
  }, db);
}

async function createContractRecord(db, worker, contractData = {}, companyId, creatorId) {
  if (contractData.createContract === false) {
    return null;
  }

  const contractType = await resolveContractType(contractData.contractType, companyId, db);
  const startDate = contractData.startDate || worker.start_date || worker.hire_date || new Date().toISOString().slice(0, 10);
  const salary = Number(contractData.salary || 0);

  return insertReturning(db, 'worker_contracts', {
    worker_id: worker.id,
    company_id: companyId,
    contract_type_id: contractType?.id || null,
    contract_type: contractType?.name || contractData.contractType,
    start_date: startDate,
    end_date: contractData.endDate || null,
    agreed_salary: salary,
    trial_period: contractData.trialPeriod === true,
    currency: contractData.currency || 'PEN',
    work_journey: contractData.workdayType || null,
    workday_type: contractData.workdayType || null,
    modality: contractData.workMode || 'onsite',
    work_mode: contractData.workMode || 'onsite',
    cost_center_id: contractData.costCenterId || null,
    observations: contractData.observations || null,
    status: 'active',
    created_by: creatorId,
    metadata: {
      onboarding: true,
      contract_type_input: contractData.contractType || null
    }
  });
}

function normalizeAccessUserPayload(payload, companyConfig) {
  const { personalData, accessData = {}, laborData } = payload;
  return {
    personalData,
    accessData,
    laborData,
    emailDomain: resolveEmailDomain(companyConfig),
    forcePasswordChange: (accessData.forcePasswordChange ?? accessData.force_password_change) !== false
  };
}

function resolveAccessRoleInput(accessData = {}) {
  return accessData.roleId
    || accessData.role_id
    || accessData.role
    || accessData.roleCode
    || accessData.role_code
    || null;
}

async function generateAccessUsername(data, db) {
  if (data.accessData.username) {
    return data.accessData.username;
  }

  const suggestions = await suggestAvailableUsernames(
    {
      firstName: data.personalData.firstName,
      paternalLastName: data.personalData.paternalLastName,
      maternalLastName: data.personalData.maternalLastName
    },
    (candidate) => usernameExists(data.laborData.companyId, candidate, null, db),
    3
  );
  return suggestions.username;
}

function resolveCorporateEmailForAccess(data, username) {
  const requestedEmail = data.accessData.corporateEmail || data.accessData.corporate_email;
  if (requestedEmail) {
    return requestedEmail;
  }

  if (!data.emailDomain) {
    throw createHttpError(422, 'COMPANY_EMAIL_DOMAIN_MISSING', 'La empresa no tiene dominio corporativo configurado.');
  }

  return generateCorporateEmail(username, data.emailDomain);
}

async function assertUsernameAvailable(companyId, username, db) {
  if (username && await usernameExists(companyId, username, null, db)) {
    throw createHttpError(409, 'USERNAME_ALREADY_EXISTS', 'El username ya se encuentra registrado.', [
      { field: 'accessData.username', message: 'El username ya se encuentra registrado.' }
    ]);
  }
}

async function assertEmailAvailable(companyId, corporateEmail, db) {
  if (await emailExists(companyId, corporateEmail, null, db)) {
    throw createHttpError(409, 'EMAIL_ALREADY_EXISTS', 'El correo corporativo ya se encuentra registrado.', [
      { field: 'accessData.corporateEmail', message: 'El correo corporativo ya se encuentra registrado.' }
    ]);
  }
}

function resolveTemporaryPassword(accessData, companyConfig) {
  return accessData.temporaryPassword
    || accessData.temporary_password
    || generateTemporaryPassword(companyConfig?.nombre_comercial || companyConfig?.company_name || 'Fabryor');
}

function mapAccessUserResponse(user, username, corporateEmail, role, forcePasswordChange) {
  return {
    id: user.id,
    username,
    email: corporateEmail,
    role: role.name,
    force_password_change: forcePasswordChange
  };
}

async function createAccessUser(db, worker, payload, companyConfig, creatorId) {
  const data = normalizeAccessUserPayload(payload, companyConfig);
  const { personalData, accessData, laborData, forcePasswordChange } = data;
  if (!accessData.createAccess) {
    return { user: null, temporaryPassword: null };
  }

  const username = await generateAccessUsername(data, db);
  const corporateEmail = resolveCorporateEmailForAccess(data, username);
  await assertEmailAvailable(laborData.companyId, corporateEmail, db);
  await assertUsernameAvailable(laborData.companyId, username, db);

  const temporaryPassword = resolveTemporaryPassword(accessData, companyConfig);
  const strengthError = validatePasswordStrength(temporaryPassword);
  if (strengthError) {
    throw createHttpError(422, 'WEAK_PASSWORD', strengthError, [
      { field: 'accessData.temporaryPassword', message: strengthError }
    ]);
  }

  const role = await resolveRole(resolveAccessRoleInput(accessData) || 'TRABAJADOR', laborData.companyId, db);
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await insertReturning(db, 'users', {
    worker_id: worker.id,
    company_id: laborData.companyId,
    username,
    email: corporateEmail,
    password_hash: passwordHash,
    first_name: personalData.firstName,
    last_name: [personalData.paternalLastName, personalData.maternalLastName].filter(Boolean).join(' '),
    full_name: [personalData.firstName, personalData.paternalLastName, personalData.maternalLastName].filter(Boolean).join(' '),
    is_active: true,
    status: 'active',
    force_password_change: forcePasswordChange,
    last_password_change_at: null,
    created_by: creatorId
  });

  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [user.id, role.id]
  );

  await updateReturning(db, 'workers', 'id', worker.id, {
    user_id: user.id,
    onboarding_status: 'user_created',
    updated_at: new Date()
  });

  return {
    user: mapAccessUserResponse(user, username, corporateEmail, role, forcePasswordChange),
    temporaryPassword
  };
}

async function updateAccessUser(db, userId, payload, companyConfig, options = {}) {
  const { personalData, accessData = {}, laborData } = payload;
  if (!accessData.createAccess) {
    return { user: null, temporaryPassword: null };
  }

  const existingUser = options.existingUser || (await workerRepository.findUserById(userId, laborData.companyId, db));
  const companyId = laborData.companyId || existingUser?.company_id;
  const roleInput = resolveAccessRoleInput(accessData);
  const shouldUpdateRole = !!roleInput || options.preserveExisting !== true;
  const role = shouldUpdateRole ? await resolveRole(roleInput || 'TRABAJADOR', companyId, db) : null;

  const updateData = { updated_at: new Date() };
  if (options.worker?.id) {
    updateData.worker_id = options.worker.id;
  }

  if (personalData.firstName) {
    updateData.first_name = personalData.firstName;
  }

  if (personalData.paternalLastName || personalData.maternalLastName) {
    updateData.last_name = [personalData.paternalLastName, personalData.maternalLastName].filter(Boolean).join(' ');
  }

  if (personalData.firstName || personalData.paternalLastName || personalData.maternalLastName) {
    updateData.full_name = [
      personalData.firstName || existingUser?.first_name,
      personalData.paternalLastName,
      personalData.maternalLastName
    ].filter(Boolean).join(' ');
  }

  const corporateEmail = accessData.corporateEmail || accessData.corporate_email;
  if (corporateEmail) {
    updateData.email = corporateEmail;
  }
  
  if (accessData.username) {
    updateData.username = accessData.username;
  }
  
  if (accessData.forcePasswordChange !== undefined || accessData.force_password_change !== undefined) {
    updateData.force_password_change = (accessData.forcePasswordChange ?? accessData.force_password_change);
  }

  let temporaryPassword = null;
  if (accessData.temporaryPassword || accessData.temporary_password) {
    temporaryPassword = accessData.temporaryPassword || accessData.temporary_password;
    const strengthError = validatePasswordStrength(temporaryPassword);
    if (strengthError) {
      throw createHttpError(422, 'WEAK_PASSWORD', strengthError, [
        { field: 'accessData.temporaryPassword', message: strengthError }
      ]);
    }
    updateData.password_hash = await hashPassword(temporaryPassword);
  }

  const user = await updateReturning(db, 'users', 'id', userId, updateData);

  if (role) {
    await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, role.id]);
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: role?.name || existingUser?.role_name || null,
      force_password_change: user.force_password_change
    },
    temporaryPassword
  };
}

async function maybeSendCredentials({ user, temporaryPassword, workerName, accessData }) {
  const shouldSend = accessData?.sendCredentialsByEmail || accessData?.send_credentials_by_email;
  if (!shouldSend || !user) {
    return null;
  }

  if (!process.env.SMTP_HOST) {
    return 'No se pudo enviar el correo con las credenciales: SMTP no configurado.';
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return 'No se pudo enviar el correo con las credenciales: nodemailer no esta instalado.';
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      } : undefined
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: 'Credenciales de acceso FABRYOR',
      text: [
        `Hola ${workerName},`,
        '',
        'Tus credenciales de acceso son:',
        `Usuario: ${user.username || user.email}`,
        `Correo: ${user.email}`,
        `Contrasena temporal: ${temporaryPassword}`,
        (accessData.forcePasswordChange ?? accessData.force_password_change) !== false ? 'Debes cambiar tu contrasena en el primer inicio de sesion.' : '',
        process.env.APP_ACCESS_URL ? `URL de acceso: ${process.env.APP_ACCESS_URL}` : ''
      ].filter(Boolean).join('\n')
    });

    return null;
  } catch {
    return 'No se pudo enviar el correo con las credenciales.';
  }
}

async function verifyRelations(payload, companyId) {
  const errors = [];
  const laborData = payload.laborData || {};
  const contractData = payload.contractData || {};

  // 1. Company
  const companyRes = await query(
    'SELECT 1 FROM companies WHERE id = $1 AND deleted_at IS NULL',
    [companyId]
  );
  if (companyRes.rowCount === 0) {
    errors.push({ field: 'laborData.companyId', message: 'La empresa especificada no existe.' });
  }

  // 2. Branch (projects)
  if (laborData.branchId) {
    const branchRes = await query(
      'SELECT 1 FROM projects WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [laborData.branchId, companyId]
    );
    if (branchRes.rowCount === 0) {
      errors.push({ field: 'laborData.branchId', message: 'La sede (proyecto) especificada no existe o no pertenece a la empresa.' });
    }
  }

  // 3. Labor area (areas)
  if (laborData.areaId) {
    const areaRes = await query(
      'SELECT 1 FROM areas WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND COALESCE(is_active, status, TRUE) = TRUE',
      [laborData.areaId, companyId]
    );
    if (areaRes.rowCount === 0) {
      errors.push({ field: 'laborData.areaId', message: 'El área (departamento) especificada no existe o no pertenece a la empresa.' });
    }
  }

  // 4. Position (job_positions)
  if (laborData.positionId) {
    const positionRes = await query(
      `SELECT 1
       FROM job_positions
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE
         AND ($3::uuid IS NULL OR area_id = $3)`,
      [laborData.positionId, companyId, laborData.areaId || null]
    );
    if (positionRes.rowCount === 0) {
      errors.push({ field: 'laborData.positionId', message: 'El cargo (puesto de trabajo) especificado no existe o no pertenece a la empresa.' });
    }
  }

  // 5. Shift (shifts)
  if (laborData.shiftId) {
    const shiftRes = await query(
      'SELECT 1 FROM shifts WHERE id = $1 AND company_id = $2 AND is_active = true',
      [laborData.shiftId, companyId]
    );
    if (shiftRes.rowCount === 0) {
      errors.push({ field: 'laborData.shiftId', message: 'El turno especificado no existe o no pertenece a la empresa.' });
    }
  }

  // 6. Supervisor (users)
  if (laborData.supervisorId) {
    const supervisorRes = await query(
      'SELECT 1 FROM users WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [laborData.supervisorId, companyId]
    );
    if (supervisorRes.rowCount === 0) {
      errors.push({ field: 'laborData.supervisorId', message: 'El supervisor especificado no existe o no pertenece a la empresa.' });
    }
  }

  // 7. Worker Type (static list)
  if (laborData.workerTypeId) {
    const exists = WORKER_TYPES.some(t => t.id === laborData.workerTypeId);
    if (!exists) {
      errors.push({ field: 'laborData.workerTypeId', message: 'El tipo de colaborador especificado no es válido.' });
    }
  }

  // 8. Cost Center (static list)
  if (contractData.createContract !== false && contractData.costCenterId) {
    const exists = COST_CENTERS.some(cc => cc.id === contractData.costCenterId);
    if (!exists) {
      errors.push({ field: 'contractData.costCenterId', message: 'El centro de costo especificado no es válido.' });
    }
  }

  // 9. Internal Department (departments)
  const internalDeptId = laborData.departmentId || laborData.department_id || laborData.internal_department_id;
  if (internalDeptId) {
    const deptRes = await query(
      'SELECT 1 FROM departments WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [internalDeptId, companyId]
    );
    if (deptRes.rowCount === 0) {
      errors.push({ field: 'laborData.departmentId', message: 'El departamento interno especificado no existe o no pertenece a la empresa.' });
    }
  }

  // 10. Geographical Department (geographic_departments)
  const personalData = payload.personalData || payload.personal_data || payload.personal || {};
  const geoDeptId = personalData.departmentId || personalData.department_id || payload.geoDepartmentId || payload.ubigeoDepartmentId;
  if (geoDeptId) {
    const geoRes = await query(
      'SELECT 1 FROM geographic_departments WHERE id = $1 AND deleted_at IS NULL',
      [geoDeptId]
    );
    if (geoRes.rowCount === 0) {
      errors.push({ field: 'personalData.departmentId', message: 'El departamento geográfico especificado no existe.' });
    }
  }

  return errors;
}

function getOnboardingContext(payload = {}) {
  return payload.onboardingContext || payload.onboarding_context || {};
}

function getContextWorkerId(payload = {}) {
  const context = getOnboardingContext(payload);
  return context.workerId || context.worker_id || null;
}

function getContextUserId(payload = {}) {
  const context = getOnboardingContext(payload);
  return context.userId || context.user_id || null;
}

function assertContextUuid(value, field, errorCode) {
  if (value && !isValidUUID(value)) {
    throw createHttpError(400, errorCode, `${field} invalido. Debe ser un UUID valido.`, [
      { field, message: `${field} invalido. Debe ser un UUID valido.` }
    ]);
  }
}

async function findUserByWorkerId(db, workerId, companyId) {
  const result = await db.query(
    `SELECT u.*
     FROM users u
     WHERE u.worker_id = $1
       AND (u.company_id = $2 OR u.company_id IS NULL)
       AND u.deleted_at IS NULL
     LIMIT 1`,
    [workerId, companyId]
  );
  return result.rows[0] || null;
}

async function resolveExistingOnboardingContext(payload, tenantId, db = { query }) {
  const workerId = getContextWorkerId(payload);
  const requestedUserId = getContextUserId(payload);

  if (!workerId) {
    return {
      existingWorkerMode: false,
      worker: null,
      user: null,
      workerId: null,
      userId: null
    };
  }

  assertContextUuid(workerId, 'workerId', 'INVALID_WORKER_ID');
  assertContextUuid(requestedUserId, 'userId', 'INVALID_USER_ID');

  const worker = await workerRepository.findWorkerById(workerId, tenantId, db);
  if (!worker) {
    throw createHttpError(404, 'WORKER_NOT_FOUND', 'No se encontro el trabajador indicado.');
  }

  const linkedUser = worker.user_id
    ? await workerRepository.findUserById(worker.user_id, tenantId, db)
    : await findUserByWorkerId(db, worker.id, tenantId);

  let user = linkedUser;
  if (requestedUserId) {
    const requestedUser = await workerRepository.findUserById(requestedUserId, tenantId, db);
    if (!requestedUser) {
      throw createHttpError(404, 'USER_NOT_FOUND', 'No se encontro el usuario indicado.');
    }

    if (worker.user_id && worker.user_id !== requestedUser.id) {
      throw createHttpError(400, 'WORKER_USER_MISMATCH', 'El usuario indicado no corresponde al trabajador seleccionado.');
    }

    if (requestedUser.worker_id && requestedUser.worker_id !== worker.id) {
      throw createHttpError(400, 'WORKER_USER_MISMATCH', 'El usuario indicado no corresponde al trabajador seleccionado.');
    }

    if (linkedUser && linkedUser.id !== requestedUser.id) {
      throw createHttpError(400, 'WORKER_USER_MISMATCH', 'El usuario indicado no corresponde al trabajador seleccionado.');
    }

    user = requestedUser;
  }

  return {
    existingWorkerMode: true,
    worker,
    user,
    workerId: worker.id,
    userId: user?.id || worker.user_id || null
  };
}

async function assertNoActiveContractForExistingWorker(db, workerId) {
  const result = await db.query(
    `SELECT id
     FROM worker_contracts
     WHERE worker_id = $1
       AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
     LIMIT 1`,
    [workerId]
  );

  if (result.rowCount > 0) {
    throw createHttpError(409, 'ACTIVE_CONTRACT_EXISTS', 'El trabajador ya tiene un contrato activo registrado.');
  }
}

async function onboardWorker(payload, req) {
  assertAuthorized(req);

  const tenantId = req.tenantId;
  const existingContext = await resolveExistingOnboardingContext(payload, tenantId);
  const incomingLaborData = payload.laborData || payload.labor_data || {};
  const companyId = incomingLaborData.companyId || incomingLaborData.company_id || existingContext.worker?.company_id;
  payload = {
    ...payload,
    personalData: payload.personalData || payload.personal_data || {},
    laborData: {
      ...incomingLaborData,
      companyId
    }
  };

  const validationErrors = validateOnboardingPayload(payload, tenantId, {
    existingWorker: existingContext.existingWorkerMode
  });
  if (validationErrors.length > 0) {
    throw createHttpError(422, 'VALIDATION_FAILED', 'Hay errores de validacion en el alta de colaborador.', validationErrors);
  }

  assertTenant(companyId, tenantId);

  const relationErrors = await verifyRelations(payload, companyId);
  if (relationErrors.length > 0) {
    throw createHttpError(422, 'VALIDATION_FAILED', 'Hay errores de validacion en el alta de colaborador.', relationErrors);
  }

  const onboardingContext = getOnboardingContext(payload);
  const isCompleteMode = onboardingContext.mode === 'complete';
  const excludeUserId = isCompleteMode
    ? (onboardingContext.userId || onboardingContext.user_id)
    : existingContext.userId;
  const excludeWorkerId = isCompleteMode
    ? (onboardingContext.workerId || onboardingContext.worker_id)
    : existingContext.workerId;

  if (isCompleteMode && (!excludeUserId && !excludeWorkerId)) {
    throw createHttpError(400, 'MISSING_PARAMS', 'Falta userId o workerId para completar información.');
  }

  const warnings = [];
  let createdUserForEmail = null;
  let temporaryPasswordForEmail = null;
  let workerNameForEmail = null;
  let resultData = null;

  if (payload.personalData?.dni) {
    await assertDniIsAvailable(companyId, payload.personalData.dni, excludeWorkerId);
  }
  await assertUserCredentialsAvailable(companyId, payload.accessData || {}, excludeUserId);

  resultData = await withTransaction(async (client) => {
    try {
      const companyConfig = await getCompanyConfig(companyId, client);
      if (!companyConfig) {
        throw createHttpError(404, 'COMPANY_NOT_FOUND', 'Empresa no encontrada.');
      }

      const txExistingContext = existingContext.existingWorkerMode
        ? await resolveExistingOnboardingContext(payload, tenantId, client)
        : existingContext;

      let worker;
      if (txExistingContext.existingWorkerMode) {
        worker = await updateWorkerRecord(client, txExistingContext.worker.id, payload, {
          existingWorker: txExistingContext.worker,
          preserveExisting: true,
          userId: txExistingContext.userId || txExistingContext.worker.user_id || undefined
        });
        await logAuditEvent({
          db: client, userId: req.user.id, companyId, module: 'WORKERS', action: 'WORKER_UPDATED',
          entity: 'workers', entityId: worker.id, newData: { onboarding_context: 'existing_worker' }, req
        });
      } else if (isCompleteMode) {
        worker = await updateWorkerRecord(client, excludeWorkerId, payload);
        await logAuditEvent({
          db: client, userId: req.user.id, companyId, module: 'WORKERS', action: 'WORKER_UPDATED',
          entity: 'workers', entityId: worker.id, newData: { dni: payload.personalData.dni }, req
        });
      } else {
        worker = await createWorkerRecord(client, payload, req.user.id);
        await logAuditEvent({
          db: client, userId: req.user.id, companyId, module: 'WORKERS', action: 'WORKER_CREATED',
          entity: 'workers', entityId: worker.id, newData: { dni: payload.personalData.dni }, req
        });
      }

      const contractDataForCreate = txExistingContext.existingWorkerMode && !payload.contractData
        ? { createContract: false }
        : (payload.contractData || {});

      if (txExistingContext.existingWorkerMode && contractDataForCreate.createContract !== false) {
        await assertNoActiveContractForExistingWorker(client, worker.id);
      }

      const contract = await createContractRecord(client, worker, contractDataForCreate, companyId, req.user.id);
      if (contract) {
        await logAuditEvent({
          db: client, userId: req.user.id, companyId, module: 'CONTRACTS', action: 'CONTRACT_CREATED',
          entity: 'worker_contracts', entityId: contract.id, newData: { worker_id: worker.id, contract_type: contractDataForCreate?.contractType }, req
        });
      }

      let access = { user: null, temporaryPassword: null };
      if (txExistingContext.existingWorkerMode) {
        if (payload.accessData?.createAccess) {
          if (txExistingContext.user) {
            access = await updateAccessUser(client, txExistingContext.user.id, payload, companyConfig, {
              existingUser: txExistingContext.user,
              preserveExisting: true,
              worker
            });
            await logAuditEvent({
              db: client, userId: req.user.id, companyId, module: 'USERS', action: 'USER_UPDATED',
              entity: 'users', entityId: access.user.id, newData: { username: access.user.username, email: access.user.email, role: access.user.role }, req
            });
          } else {
            access = await createAccessUser(client, worker, payload, companyConfig, req.user.id);
            if (access.user) {
              createdUserForEmail = access.user;
              temporaryPasswordForEmail = access.temporaryPassword;
              workerNameForEmail = [payload.personalData.firstName || worker.first_name, payload.personalData.paternalLastName || worker.paternal_last_name, payload.personalData.maternalLastName || worker.maternal_last_name].filter(Boolean).join(' ');

              await logAuditEvent({
                db: client, userId: req.user.id, companyId, module: 'USERS', action: 'USER_CREATED',
                entity: 'users', entityId: access.user.id, newData: { username: access.user.username, email: access.user.email, role: access.user.role }, req
              });
            }
          }
        } else if (txExistingContext.user) {
          access = {
            user: {
              id: txExistingContext.user.id,
              username: txExistingContext.user.username,
              email: txExistingContext.user.email,
              role: txExistingContext.user.role_name || null,
              force_password_change: txExistingContext.user.force_password_change
            },
            temporaryPassword: null
          };
        }
      } else if (isCompleteMode && excludeUserId && payload.accessData?.createAccess) {
        access = await updateAccessUser(client, excludeUserId, payload, companyConfig);
        await logAuditEvent({
          db: client, userId: req.user.id, companyId, module: 'USERS', action: 'USER_UPDATED',
          entity: 'users', entityId: access.user.id, newData: { username: access.user.username, email: access.user.email, role: access.user.role }, req
        });
      } else {
        access = await createAccessUser(client, worker, payload, companyConfig, req.user.id);
        if (access.user) {
          createdUserForEmail = access.user;
          temporaryPasswordForEmail = access.temporaryPassword;
          workerNameForEmail = [payload.personalData.firstName, payload.personalData.paternalLastName, payload.personalData.maternalLastName].filter(Boolean).join(' ');

          await logAuditEvent({
            db: client, userId: req.user.id, companyId, module: 'USERS', action: 'USER_CREATED',
            entity: 'users', entityId: access.user.id, newData: { username: access.user.username, email: access.user.email, role: access.user.role }, req
          });
        }
      }

      let generatedContract = null;
      if (contract && payload.contractData?.generateContract === true) {
        try {
          generatedContract = await contractService.generateContractPdf({
            db: client, companyId, contractId: contract.id, requestedBy: req.user.id, req
          });
        } catch (error) {
          if (payload.contractData?.requireGeneratedPdf === true) {
            throw error;
          }
          warnings.push('No se pudo generar el PDF del contrato.');
          await logAuditEvent({
            db: client, userId: req.user.id, companyId, module: 'ONBOARDING', action: 'ONBOARDING_WARNING',
            entity: 'workers', entityId: worker.id, newData: { warning: 'CONTRACT_GENERATE_FAILED', error: error.message }, req
          });
        }
      }

      await updateReturning(client, 'workers', 'id', worker.id, {
        onboarding_status: warnings.length > 0 ? 'completed_with_warnings' : 'completed',
        updated_at: new Date()
      });

      await logAuditEvent({
        db: client, userId: req.user.id, companyId, module: 'ONBOARDING', action: (isCompleteMode || txExistingContext.existingWorkerMode) ? 'ONBOARDING_UPDATED' : 'ONBOARDING_COMPLETED',
        entity: 'workers', entityId: worker.id, newData: { worker_id: worker.id, user_id: access.user?.id || null, contract_id: contract?.id || null, warnings }, metadata: getRequestMeta(req), req
      });

      const responseMode = onboardingContext.mode || (txExistingContext.existingWorkerMode ? 'create' : undefined);
      const profileStatus = warnings.length > 0 ? 'completed_with_warnings' : 'complete';

      return {
        mode: responseMode,
        worker_id: worker.id,
        workerId: worker.id,
        user_id: access.user?.id || txExistingContext.userId || null,
        userId: access.user?.id || txExistingContext.userId || null,
        contract_id: contract?.id || null,
        contractId: contract?.id || null,
        contract_pdf_url: generatedContract?.pdf_url || null,
        contractPdfUrl: generatedContract?.pdf_url || null,
        profile_status: profileStatus,
        profileStatus,
        force_password_change: access.user?.force_password_change || null,
        warnings
      };
    } catch (error) {
      await logAuditEvent({
        db: client, userId: req.user.id, companyId, module: 'ONBOARDING', action: 'ONBOARDING_FAILED',
        entity: 'workers', entityId: null, newData: { code: error.errorCode || 'ONBOARDING_FAILED', message: error.message }, req
      });
      throw error;
    }
  });

  const emailWarning = await maybeSendCredentials({
    user: createdUserForEmail,
    temporaryPassword: temporaryPasswordForEmail,
    workerName: workerNameForEmail,
    accessData: payload.accessData || {}
  });

  if (emailWarning) {
    resultData.warnings.push(emailWarning);
    await logAuditEvent({
      userId: req.user.id,
      companyId,
      module: 'ONBOARDING',
      action: 'ONBOARDING_WARNING',
      entity: 'workers',
      entityId: resultData.worker_id,
      newData: { warning: emailWarning },
      req
    });
  }

  return {
    statusCode: existingContext.existingWorkerMode ? 200 : 201,
    success: true,
    message: existingContext.existingWorkerMode
      ? (resultData.warnings.length > 0 ? 'Onboarding actualizado con advertencias.' : 'Onboarding actualizado correctamente.')
      : (resultData.warnings.length > 0 ? 'Colaborador creado con advertencias.' : 'Colaborador creado correctamente.'),
    data: resultData
  };
}

async function getOnboardingStatus(workerId, companyId) {
  assertValidWorkerId(workerId);

  const workerRes = await query(
    `SELECT id, user_id
     FROM workers
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL`,
    [workerId, companyId]
  );

  const worker = workerRes.rows[0];
  if (!worker) {
    throw createHttpError(404, 'WORKER_NOT_FOUND', 'Trabajador no encontrado.');
  }

  const contractRes = await query(
    `SELECT wc.*,
            EXISTS (
              SELECT 1
              FROM contract_documents cd
              WHERE cd.contract_id = wc.id
                AND cd.document_type = 'signed_contract'
            ) AS has_signed_document
     FROM worker_contracts wc
     WHERE wc.worker_id = $1
     ORDER BY wc.created_at DESC
     LIMIT 1`,
    [workerId]
  );

  const contract = contractRes.rows[0] || null;
  const workerCreated = true;
  const userCreated = !!worker.user_id;
  const contractCreated = !!contract;
  const contractGenerated = !!(contract?.generated_pdf_url);
  const signedContractUploaded = !!(contract?.signed_file_url || contract?.has_signed_document);

  const pendingSteps = [];
  if (!userCreated) pendingSteps.push('user_creation');
  if (!contractCreated) pendingSteps.push('contract_creation');
  if (contractCreated && !contractGenerated) pendingSteps.push('contract_generation');
  if (contractCreated && !signedContractUploaded) pendingSteps.push('signed_contract_upload');

  return {
    worker_created: workerCreated,
    user_created: userCreated,
    contract_created: contractCreated,
    contract_generated: contractGenerated,
    signed_contract_uploaded: signedContractUploaded,
    completed: pendingSteps.length === 0,
    pending_steps: pendingSteps
  };
}

async function getOnboardingPrefill(userId, workerId, companyId) {
  function cleanValue(val) {
    if (val === undefined || val === null || String(val).trim() === '') {
      return null;
    }
    return val;
  }

  let targetWorkerId = workerId && workerId !== 'undefined' && workerId !== 'null' && String(workerId).trim() !== '' ? String(workerId).trim() : null;
  let targetUserId = userId && userId !== 'undefined' && userId !== 'null' && String(userId).trim() !== '' ? String(userId).trim() : null;

  if (targetWorkerId) {
    if (!isValidUUID(targetWorkerId)) {
      throw createHttpError(400, 'INVALID_WORKER_ID', 'workerId inválido. Debe ser un UUID válido.');
    }
  }
  if (targetUserId) {
    if (!isValidUUID(targetUserId)) {
      throw createHttpError(400, 'INVALID_USER_ID', 'userId inválido. Debe ser un UUID válido.');
    }
  }

  if (!targetWorkerId && !targetUserId) {
    throw createHttpError(400, 'MISSING_IDENTIFIER', 'Debe enviar workerId o userId para precargar el formulario.');
  }

  let worker = null;
  let user = null;

  if (targetWorkerId) {
    // 1. Fetch worker first (with tenant/company boundary check)
    const wRes = await query(`
      SELECT w.*,
             (SELECT crew_id FROM crew_workers cw WHERE cw.worker_id = w.id LIMIT 1) AS crew_id
      FROM workers w 
      WHERE w.id = $1 AND w.company_id = $2 AND w.deleted_at IS NULL
    `, [targetWorkerId, companyId]);
    worker = wRes.rows[0] || null;

    if (!worker) {
      throw createHttpError(404, 'WORKER_NOT_FOUND', 'No se encontró el trabajador solicitado.');
    }

    // 2. Fetch associated user
    if (worker.user_id) {
      targetUserId = worker.user_id;
      const uRes = await query(`
        SELECT u.*,
               role_data.role_id,
               role_data.role_name,
               role_data.role_code
        FROM users u
        LEFT JOIN LATERAL (
          SELECT ur.role_id,
                 r.name AS role_name,
                 r.code AS role_code
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id
            AND r.deleted_at IS NULL
            AND (r.company_id = $2 OR r.company_id IS NULL)
          ORDER BY CASE WHEN r.company_id = $2 THEN 0 ELSE 1 END,
                   r.created_at ASC NULLS LAST
          LIMIT 1
        ) role_data ON TRUE
        WHERE u.id = $1 AND u.company_id = $2 AND u.deleted_at IS NULL
      `, [targetUserId, companyId]);
      user = uRes.rows[0] || null;
    }
  } else if (targetUserId) {
    // 1. Fetch user first (with tenant check)
    const uRes = await query(`
      SELECT u.*,
             role_data.role_id,
             role_data.role_name,
             role_data.role_code
      FROM users u
      LEFT JOIN LATERAL (
        SELECT ur.role_id,
               r.name AS role_name,
               r.code AS role_code
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
          AND r.deleted_at IS NULL
          AND (r.company_id = $2 OR r.company_id IS NULL)
        ORDER BY CASE WHEN r.company_id = $2 THEN 0 ELSE 1 END,
                 r.created_at ASC NULLS LAST
        LIMIT 1
      ) role_data ON TRUE
      WHERE u.id = $1 AND u.company_id = $2 AND u.deleted_at IS NULL
    `, [targetUserId, companyId]);
    user = uRes.rows[0] || null;

    if (!user) {
      throw createHttpError(404, 'USER_NOT_FOUND', 'No se encontró el usuario solicitado.');
    }

    // 2. Fetch associated worker
    const wRes = await query(`
      SELECT w.*,
             (SELECT crew_id FROM crew_workers cw WHERE cw.worker_id = w.id LIMIT 1) AS crew_id
      FROM workers w 
      WHERE w.user_id = $1 AND w.company_id = $2 AND w.deleted_at IS NULL
      LIMIT 1
    `, [targetUserId, companyId]);
    worker = wRes.rows[0] || null;
    if (worker) {
      targetWorkerId = worker.id;
    }
  }

  const lastNameParts = (worker?.paternal_last_name || user?.last_name || '').trim().split(/\s+/);
  const paternalLastName = worker?.paternal_last_name || lastNameParts[0] || null;
  const maternalLastName = worker?.maternal_last_name || (lastNameParts.length > 1 ? lastNameParts.slice(1).join(' ') : null);

  const finalDni = worker?.document_number || worker?.personal_id || buildPendingDocumentNumber(targetUserId || user?.id);

  const personalData = {
    dni: cleanValue(finalDni),
    documentNumber: cleanValue(finalDni),
    firstName: cleanValue(worker?.first_name || user?.first_name),
    paternalLastName: cleanValue(paternalLastName),
    maternalLastName: cleanValue(maternalLastName),
    birthDate: worker?.birth_date ? toDateOnly(worker.birth_date) : null,
    phone: cleanValue(worker?.phone_number || user?.phone),
    personalEmail: cleanValue(worker?.personal_email || user?.email),
    address: cleanValue(worker?.address),
    departmentId: cleanValue(worker?.department_id)
  };

  const startDateRaw = worker?.start_date || worker?.entry_date || worker?.hire_date || null;
  const entryDateRaw = worker?.entry_date || worker?.start_date || worker?.hire_date || null;

  const startDate = startDateRaw ? toDateOnly(startDateRaw) : null;
  const entryDate = entryDateRaw ? toDateOnly(entryDateRaw) : null;
  const status = cleanValue(worker?.status) || (worker?.is_active === false ? 'inactive' : 'active');

  const laborData = {
    companyId: cleanValue(worker?.company_id),
    branchId: cleanValue(worker?.branch_id),
    departmentId: cleanValue(worker?.internal_department_id),
    areaId: cleanValue(worker?.area_id),
    positionId: cleanValue(worker?.position_id || worker?.job_position_id),
    workLocationId: cleanValue(worker?.work_location_id),
    workerTypeId: cleanValue(worker?.worker_type_id),
    shiftId: cleanValue(worker?.shift_id),
    supervisorId: cleanValue(worker?.supervisor_id),
    startDate: startDate,
    entryDate: entryDate,
    status: status
  };

  const roleId = cleanValue(user?.role_id);
  const roleName = cleanValue(user?.role_name);
  const roleCode = cleanValue(user?.role_code);
  const accessData = {
    roleId,
    role: cleanValue(roleCode || roleName),
    roleName,
    roleCode,
    username: cleanValue(user?.username),
    corporateEmail: cleanValue(user?.email)
  };

  // Calculate missingFields
  const missingFields = [];
  if (!personalData.dni || String(personalData.dni).startsWith('PENDIENTE-')) {
    missingFields.push('personalData.dni');
  }
  if (!personalData.firstName) {
    missingFields.push('personalData.firstName');
  }
  if (!personalData.paternalLastName) {
    missingFields.push('personalData.paternalLastName');
  }
  if (!laborData.companyId) {
    missingFields.push('laborData.companyId');
  }
  if (!laborData.departmentId) {
    missingFields.push('laborData.departmentId');
  }
  if (!laborData.areaId) {
    missingFields.push('laborData.areaId');
  }
  if (!laborData.positionId) {
    missingFields.push('laborData.positionId');
  }
  if (!laborData.startDate) {
    missingFields.push('laborData.startDate');
  }

  const profileStatus = missingFields.length > 0 ? 'incomplete' : 'complete';

  return {
    sourceUserId: targetUserId || null,
    sourceWorkerId: targetWorkerId || null,
    profileStatus,
    personalData,
    laborData,
    accessData,
    missingFields
  };
}

async function getCompleteProfileData(userId, tenantId, db = { query }) {
  assertValidUserId(userId);

  const user = await workerRepository.findUserById(userId, tenantId, db);
  if (!user) {
    throw createHttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  const worker = await workerRepository.findWorkerByUserId(userId, tenantId, db);

  const activeQuery = (hasStatus) => hasStatus 
    ? `deleted_at IS NULL AND COALESCE(is_active, status, TRUE) = TRUE`
    : `deleted_at IS NULL AND COALESCE(is_active, TRUE) = TRUE`;

  const NULL_UUID = '00000000-0000-0000-0000-000000000000';

  const [compRes, depRes, areaRes, posRes, locRes, shiftRes, supRes] = await Promise.all([
    db.query(`SELECT id, name FROM companies WHERE id = $1 AND deleted_at IS NULL AND COALESCE(is_active, TRUE) = TRUE`, [tenantId]),
    db.query(`SELECT id, name FROM departments WHERE company_id = $1 AND (${activeQuery(true)} OR id = $2) ORDER BY name`, [tenantId, worker?.internal_department_id || NULL_UUID]),
    db.query(`SELECT id, name, department_id FROM areas WHERE company_id = $1 AND (${activeQuery(false)} OR id = $2) ORDER BY name`, [tenantId, worker?.area_id || NULL_UUID]),
    db.query(
      `SELECT jp.id,
              jp.name,
              jp.area_id,
              a.name AS area_name,
              jp.name || COALESCE(' (' || a.name || ')', '') AS display_name
       FROM job_positions jp
       LEFT JOIN areas a ON a.id = jp.area_id AND a.deleted_at IS NULL
       WHERE jp.company_id = $1
         AND (
           (jp.deleted_at IS NULL AND COALESCE(jp.is_active, jp.status, TRUE) = TRUE)
           OR jp.id = $2
         )
       ORDER BY a.name ASC NULLS LAST, jp.name ASC`,
      [tenantId, worker?.position_id || worker?.job_position_id || NULL_UUID]
    ),
    db.query(`SELECT id, name FROM work_locations WHERE company_id = $1 AND (${activeQuery(true)} OR id = $2) ORDER BY name`, [tenantId, worker?.work_location_id || NULL_UUID]),
    db.query(`SELECT id, name FROM shifts WHERE company_id = $1 ORDER BY name`, [tenantId]).catch(() => ({ rows: [] })),
    db.query(`
      SELECT DISTINCT u.id, u.first_name, u.last_name 
      FROM users u 
      JOIN user_roles ur ON u.id = ur.user_id 
      JOIN roles r ON ur.role_id = r.id 
      WHERE (u.company_id = $1 OR u.company_id IS NULL)
        AND u.deleted_at IS NULL 
        AND (
          (r.code IN ('SUPERVISOR', 'ADMIN', 'MANAGER') AND COALESCE(u.is_active, TRUE) = TRUE)
          OR u.id = $2
        )
      ORDER BY u.first_name
    `, [tenantId, worker?.supervisor_id || NULL_UUID]).catch(() => ({ rows: [] }))
  ]);

  return mapCompleteProfileGetResponse({
    user,
    worker,
    tenantId,
    catalogs: {
      companies: compRes.rows,
      departments: depRes.rows,
      areas: areaRes.rows,
      positions: posRes.rows,
      work_locations: locRes.rows,
      worker_types: WORKER_TYPES,
      shifts: shiftRes.rows,
      supervisors: supRes.rows.map(s => ({ id: s.id, name: `${s.first_name || ''} ${s.last_name || ''}`.trim() }))
    }
  });
}
async function processCompleteProfile(userId, payload, tenantId, creatorId) {
  const normalizedPayload = normalizeCompleteProfilePayload(payload);
  const { laborData, personalData } = normalizedPayload;
  const db = { query, withTransaction };

  assertValidUserId(userId);

  const { validateCompleteProfilePayload } = require('./validators');
  const errors = validateCompleteProfilePayload(payload, tenantId);
  if (errors.length > 0) {
    throw createHttpError(422, 'VALIDATION_FAILED', 'Errores de validacion.', errors);
  }

  if (laborData.departmentId) {
    const deptRes = await db.query(
      'SELECT 1 FROM departments WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [laborData.departmentId, tenantId]
    );
    if (deptRes.rowCount === 0) {
      throw createHttpError(400, 'INVALID_DEPARTMENT', 'El departamento interno no existe o no pertenece a la empresa.');
    }
  }

  if (personalData.departmentId) {
    const geoRes = await db.query(
      'SELECT 1 FROM geographic_departments WHERE id = $1 AND deleted_at IS NULL',
      [personalData.departmentId]
    );
    if (geoRes.rowCount === 0) {
      throw createHttpError(400, 'INVALID_GEO_DEPARTMENT', 'El departamento geográfico no existe.');
    }
  }

  const user = await workerRepository.findUserById(userId, tenantId, db);
  if (!user) {
    throw createHttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  const worker = await workerRepository.findWorkerByUserId(userId, tenantId, db);
  const warnings = [];

  if (laborData.positionId && laborData.areaId) {
    const posRes = await db.query(`SELECT area_id FROM job_positions WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL LIMIT 1`, [laborData.positionId, tenantId]);
    if (posRes.rows[0] && posRes.rows[0].area_id !== laborData.areaId) {
      if (worker && (worker.position_id === laborData.positionId || worker.job_position_id === laborData.positionId)) {
        warnings.push({
          field: 'position_id',
          message: 'El cargo actual no pertenece al area seleccionada, pero se conserva porque ya estaba asignado previamente.'
        });
      } else {
        throw createHttpError(422, 'INVALID_POSITION', 'El cargo no pertenece al area seleccionada.', [
          { field: 'laborData.positionId', message: 'Cargo invalido para el area.' }
        ]);
      }
    }
  }

  let updatedWorker;

  await db.withTransaction(async (client) => {
    const resolvedFirstName = firstPresent(personalData.firstName, user.first_name, worker?.first_name);
    const resolvedLastName = firstPresent(personalData.paternalLastName, user.last_name, worker?.paternal_last_name);
    const resolvedFullName = [resolvedFirstName, resolvedLastName].filter(Boolean).join(' ');

    if (personalData.firstName || personalData.paternalLastName) {
      await client.query(
        `UPDATE users
         SET first_name = COALESCE($1, first_name),
             last_name = COALESCE($2, last_name),
             full_name = COALESCE(NULLIF($3, ''), full_name),
             updated_at = NOW(),
             updated_by = $4
         WHERE id = $5`,
        [
          personalData.firstName || null,
          personalData.paternalLastName || null,
          resolvedFullName || null,
          creatorId,
          user.id
        ]
      );
    }

    if (worker) {
      updatedWorker = await workerRepository.updateWorker(worker.id, {
        ...buildWorkerPersistenceData(normalizedPayload, {
          existingWorker: worker,
          preserveExisting: true
        }),
        updated_at: new Date()
      }, client);
    } else {
      const createData = buildWorkerPersistenceData(normalizedPayload, {
        userId: user.id,
        creatorId,
        onboardingStatus: 'profile_completed'
      });

      if (!createData.document_number) {
        createData.document_number = buildPendingDocumentNumber(user.id);
        createData.personal_id = createData.document_number;
      }

      createData.company_id = tenantId;
      createData.personal_email = createData.personal_email || user.email;
      createData.first_name = createData.first_name || resolvedFirstName;
      createData.paternal_last_name = createData.paternal_last_name || resolvedLastName;
      updatedWorker = await workerRepository.createWorker(createData, client);
    }

    if (payload.contractData?.createContract && payload.contractData.contractType && payload.contractData.startDate) {
      await createContractRecord(client, updatedWorker, payload.contractData, tenantId, creatorId);
    }
  });

  return { data: mapCompleteProfilePutResponse({ userId: user.id, worker: updatedWorker }), warnings };
}
module.exports = {
  suggestCredentials,
  onboardWorker,
  getOnboardingStatus,
  getOnboardingPrefill,
  getCompleteProfileData,
  processCompleteProfile,
  createHttpError
};
