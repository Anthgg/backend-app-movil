const { query, withTransaction } = require('../../config/database');
const { validateOnboardingPayload, WORKER_TYPES, COST_CENTERS } = require('./validators');
const { suggestAvailableUsernames, generateCorporateEmail } = require('../../utils/credentials.util');
const { validatePasswordStrength, generateTemporaryPassword, hashPassword } = require('../../utils/password.util');
const { insertReturning, updateReturning, tableHasColumn } = require('../../utils/db.util');
const { logAuditEvent } = require('../../utils/audit.util');
const contractService = require('../contract-service/services');

const ALLOWED_ACCESS_ROLES = new Set(['ADMIN', 'RRHH', 'SUPERVISOR', 'TRABAJADOR']);

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) {
    error.errors = errors;
  }
  return error;
}

function normalizeStatus(value) {
  return String(value || 'active').trim().toLowerCase();
}

function toDateOnly(value) {
  if (!value) return null;
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
  if (!username || !(await tableHasColumn('users', 'username', db))) {
    return false;
  }

  const queryStr = excludeUserId 
    ? `SELECT id FROM users WHERE company_id = $1 AND LOWER(username) = LOWER($2) AND id != $3 AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM users WHERE company_id = $1 AND LOWER(username) = LOWER($2) AND deleted_at IS NULL LIMIT 1`;
  const params = excludeUserId ? [companyId, username, excludeUserId] : [companyId, username];

  const result = await db.query(queryStr, params);
  return result.rows.length > 0;
}

async function emailExists(companyId, email, excludeUserId = null, db = { query }) {
  const queryStr = excludeUserId
    ? `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND (company_id = $2 OR company_id IS NULL) AND id != $3 AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND (company_id = $2 OR company_id IS NULL) AND deleted_at IS NULL LIMIT 1`;
  const params = excludeUserId ? [email, companyId, excludeUserId] : [email, companyId];

  const result = await db.query(queryStr, params);
  return result.rows.length > 0;
}

async function assertDniIsAvailable(companyId, dni, excludeWorkerId = null, db = { query }) {
  const queryStr = excludeWorkerId
    ? `SELECT id FROM workers WHERE company_id = $1 AND document_number = $2 AND id != $3 AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM workers WHERE company_id = $1 AND document_number = $2 AND deleted_at IS NULL LIMIT 1`;
  const params = excludeWorkerId ? [companyId, dni, excludeWorkerId] : [companyId, dni];

  const result = await db.query(queryStr, params);

  if (result.rows.length > 0) {
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

async function resolveRole(roleName, companyId, db = { query }) {
  const normalized = String(roleName || 'TRABAJADOR').trim().toUpperCase();
  if (!ALLOWED_ACCESS_ROLES.has(normalized)) {
    throw createHttpError(422, 'INVALID_ROLE', 'El rol especificado no es valido.', [
      { field: 'accessData.role', message: 'El rol especificado no es valido.' }
    ]);
  }

  const result = await db.query(`
    SELECT id, name, code
    FROM roles
    WHERE (UPPER(code) = $1 OR UPPER(name) = $1)
      AND (company_id = $2 OR company_id IS NULL)
      AND deleted_at IS NULL
      AND COALESCE(is_active, TRUE) = TRUE
    ORDER BY CASE WHEN company_id = $2 THEN 0 ELSE 1 END, created_at ASC NULLS LAST
    LIMIT 1
  `, [normalized, companyId]);

  if (!result.rows[0]) {
    throw createHttpError(422, 'INVALID_ROLE', 'El rol especificado no existe en la empresa.', [
      { field: 'accessData.role', message: 'El rol especificado no existe.' }
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
    throw createHttpError(422, 'COMPANY_EMAIL_DOMAIN_MISSING', 'La empresa no tiene dominio corporativo configurado.');
  }

  const suggestions = await suggestAvailableUsernames(
    { firstName, paternalLastName, maternalLastName },
    (candidate) => usernameExists(companyId, candidate),
    5
  );

  return {
    username: suggestions.username,
    username_suggestions: suggestions.username_suggestions,
    corporate_email: generateCorporateEmail(suggestions.username, emailDomain),
    force_password_change: true
  };
}

async function createWorkerRecord(db, payload, creatorId) {
  const { personalData, laborData } = payload;
  const employmentStatus = normalizeStatus(laborData.status);

  return insertReturning(db, 'workers', {
    user_id: null,
    company_id: laborData.companyId,
    document_type: 'DNI',
    document_number: personalData.dni,
    personal_id: personalData.dni,
    first_name: personalData.firstName,
    paternal_last_name: personalData.paternalLastName,
    maternal_last_name: personalData.maternalLastName || null,
    birth_date: personalData.birthDate || null,
    gender: personalData.gender || null,
    civil_status: personalData.civilStatus || null,
    nationality: personalData.nationality || null,
    phone_number: personalData.phone || null,
    secondary_phone: personalData.secondaryPhone || null,
    personal_email: personalData.personalEmail || null,
    address: personalData.address || null,
    district: personalData.district || null,
    province: personalData.province || null,
    department: personalData.department || null,
    emergency_contact_name: personalData.emergencyContactName || null,
    emergency_contact_phone: personalData.emergencyContactPhone || null,
    branch_id: laborData.branchId || null,
    area_id: laborData.areaId || null,
    internal_department_id: laborData.departmentId || null,
    work_location_id: laborData.workLocationId || null,
    position_id: laborData.positionId || null,
    job_position_id: laborData.positionId || null,
    worker_type_id: laborData.workerTypeId || null,
    shift_id: laborData.shiftId || null,
    contract_type: laborData.contractType || null,
    start_date: laborData.startDate,
    hire_date: laborData.startDate,
    supervisor_id: laborData.supervisorId || null,
    status: employmentStatus === 'active' ? 'ACTIVE' : employmentStatus.toUpperCase(),
    employment_status: employmentStatus,
    is_active: employmentStatus === 'active',
    onboarding_status: 'worker_created',
    created_by: creatorId
  });
}

async function updateWorkerRecord(db, workerId, payload) {
  const { personalData, laborData } = payload;
  const employmentStatus = normalizeStatus(laborData.status);

  return updateReturning(db, 'workers', 'id', workerId, {
    document_type: 'DNI',
    document_number: personalData.dni,
    personal_id: personalData.dni,
    first_name: personalData.firstName,
    paternal_last_name: personalData.paternalLastName,
    maternal_last_name: personalData.maternalLastName || null,
    birth_date: personalData.birthDate || null,
    gender: personalData.gender || null,
    civil_status: personalData.civilStatus || null,
    nationality: personalData.nationality || null,
    phone_number: personalData.phone || null,
    secondary_phone: personalData.secondaryPhone || null,
    personal_email: personalData.personalEmail || null,
    address: personalData.address || null,
    district: personalData.district || null,
    province: personalData.province || null,
    department: personalData.department || null,
    emergency_contact_name: personalData.emergencyContactName || null,
    emergency_contact_phone: personalData.emergencyContactPhone || null,
    branch_id: laborData.branchId || null,
    area_id: laborData.areaId || null,
    internal_department_id: laborData.departmentId || null,
    work_location_id: laborData.workLocationId || null,
    position_id: laborData.positionId || null,
    job_position_id: laborData.positionId || null,
    worker_type_id: laborData.workerTypeId || null,
    shift_id: laborData.shiftId || null,
    contract_type: laborData.contractType || null,
    start_date: laborData.startDate,
    hire_date: laborData.startDate,
    supervisor_id: laborData.supervisorId || null,
    status: employmentStatus === 'active' ? 'ACTIVE' : employmentStatus.toUpperCase(),
    employment_status: employmentStatus,
    is_active: employmentStatus === 'active',
    updated_at: new Date()
  });
}

async function createContractRecord(db, worker, contractData = {}, companyId, creatorId) {
  if (contractData.createContract === false) {
    return null;
  }

  const contractType = await resolveContractType(contractData.contractType, companyId, db);
  const startDate = contractData.startDate || worker.start_date || worker.hire_date;
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

async function createAccessUser(db, worker, payload, companyConfig, creatorId) {
  const { personalData, accessData = {}, laborData } = payload;
  if (!accessData.createAccess) {
    return { user: null, temporaryPassword: null };
  }

  const emailDomain = resolveEmailDomain(companyConfig);
  let username = accessData.username;

  if (!username) {
    const suggestions = await suggestAvailableUsernames(
      {
        firstName: personalData.firstName,
        paternalLastName: personalData.paternalLastName,
        maternalLastName: personalData.maternalLastName
      },
      (candidate) => usernameExists(laborData.companyId, candidate, db),
      3
    );
    username = suggestions.username;
  }

  let corporateEmail = accessData.corporateEmail || accessData.corporate_email;
  if (!corporateEmail) {
    if (!emailDomain) {
      throw createHttpError(422, 'COMPANY_EMAIL_DOMAIN_MISSING', 'La empresa no tiene dominio corporativo configurado.');
    }
    corporateEmail = generateCorporateEmail(username, emailDomain);
  }

  if (await emailExists(laborData.companyId, corporateEmail, db)) {
    throw createHttpError(409, 'EMAIL_ALREADY_EXISTS', 'El correo corporativo ya se encuentra registrado.', [
      { field: 'accessData.corporateEmail', message: 'El correo corporativo ya se encuentra registrado.' }
    ]);
  }

  if (username && await usernameExists(laborData.companyId, username, db)) {
    throw createHttpError(409, 'USERNAME_ALREADY_EXISTS', 'El username ya se encuentra registrado.', [
      { field: 'accessData.username', message: 'El username ya se encuentra registrado.' }
    ]);
  }

  const temporaryPassword = accessData.temporaryPassword || accessData.temporary_password || generateTemporaryPassword(companyConfig?.nombre_comercial || companyConfig?.company_name || 'Fabryor');
  const strengthError = validatePasswordStrength(temporaryPassword);
  if (strengthError) {
    throw createHttpError(422, 'WEAK_PASSWORD', strengthError, [
      { field: 'accessData.temporaryPassword', message: strengthError }
    ]);
  }

  const role = await resolveRole(accessData.role || 'TRABAJADOR', laborData.companyId, db);
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
    force_password_change: (accessData.forcePasswordChange ?? accessData.force_password_change) !== false,
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
    user: {
      id: user.id,
      username,
      email: corporateEmail,
      role: role.name,
      force_password_change: (accessData.forcePasswordChange ?? accessData.force_password_change) !== false
    },
    temporaryPassword
  };
}

async function updateAccessUser(db, userId, payload, companyConfig) {
  const { personalData, accessData = {}, laborData } = payload;
  if (!accessData.createAccess) {
    return { user: null, temporaryPassword: null };
  }

  const role = await resolveRole(accessData.role || 'TRABAJADOR', laborData.companyId, db);
  
  const updateData = {
    first_name: personalData.firstName,
    last_name: [personalData.paternalLastName, personalData.maternalLastName].filter(Boolean).join(' '),
    full_name: [personalData.firstName, personalData.paternalLastName, personalData.maternalLastName].filter(Boolean).join(' '),
    updated_at: new Date()
  };

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

  // Mover rol antiguo si difiere y colocar el nuevo
  await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
  await db.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, role.id]);

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: role.name,
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

  return errors;
}

async function onboardWorker(payload, req) {
  assertAuthorized(req);

  const tenantId = req.tenantId;
  const validationErrors = validateOnboardingPayload(payload, tenantId);
  if (validationErrors.length > 0) {
    throw createHttpError(422, 'VALIDATION_FAILED', 'Hay errores de validacion en el alta de colaborador.', validationErrors);
  }

  const companyId = payload.laborData.companyId;
  assertTenant(companyId, tenantId);

  const relationErrors = await verifyRelations(payload, companyId);
  if (relationErrors.length > 0) {
    throw createHttpError(422, 'VALIDATION_FAILED', 'Hay errores de validacion en el alta de colaborador.', relationErrors);
  }

  const isCompleteMode = payload.onboardingContext?.mode === 'complete';
  const excludeUserId = isCompleteMode ? payload.onboardingContext?.userId : null;
  const excludeWorkerId = isCompleteMode ? payload.onboardingContext?.workerId : null;

  if (isCompleteMode && (!excludeUserId && !excludeWorkerId)) {
    throw createHttpError(400, 'MISSING_PARAMS', 'Falta userId o workerId para completar información.');
  }

  const warnings = [];
  let createdUserForEmail = null;
  let temporaryPasswordForEmail = null;
  let workerNameForEmail = null;
  let resultData = null;

  await assertDniIsAvailable(companyId, payload.personalData.dni, excludeWorkerId);
  await assertUserCredentialsAvailable(companyId, payload.accessData || {}, excludeUserId);

  resultData = await withTransaction(async (client) => {
    try {
      const companyConfig = await getCompanyConfig(companyId, client);
      if (!companyConfig) {
        throw createHttpError(404, 'COMPANY_NOT_FOUND', 'Empresa no encontrada.');
      }

      let worker;
      if (isCompleteMode) {
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

      const contract = await createContractRecord(client, worker, payload.contractData || {}, companyId, req.user.id);
      if (contract) {
        await logAuditEvent({
          db: client, userId: req.user.id, companyId, module: 'CONTRACTS', action: 'CONTRACT_CREATED',
          entity: 'worker_contracts', entityId: contract.id, newData: { worker_id: worker.id, contract_type: payload.contractData?.contractType }, req
        });
      }

      let access = { user: null, temporaryPassword: null };
      if (isCompleteMode && excludeUserId && payload.accessData?.createAccess) {
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
        db: client, userId: req.user.id, companyId, module: 'ONBOARDING', action: isCompleteMode ? 'ONBOARDING_UPDATED' : 'ONBOARDING_COMPLETED',
        entity: 'workers', entityId: worker.id, newData: { worker_id: worker.id, user_id: access.user?.id || null, contract_id: contract?.id || null, warnings }, metadata: getRequestMeta(req), req
      });

      return {
        worker_id: worker.id,
        user_id: access.user?.id || null,
        contract_id: contract?.id || null,
        contract_pdf_url: generatedContract?.pdf_url || null,
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
    success: true,
    message: resultData.warnings.length > 0 ? 'Colaborador creado con advertencias.' : 'Colaborador creado correctamente.',
    data: resultData
  };
}

async function getOnboardingStatus(workerId, companyId) {
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
  let targetWorkerId = workerId && workerId !== 'undefined' && workerId !== 'null' ? workerId : null;
  let targetUserId = userId && userId !== 'undefined' && userId !== 'null' ? userId : null;

  if (!targetUserId && !targetWorkerId) {
    throw createHttpError(400, 'MISSING_PARAMS', 'Se requiere userId o workerId válidos.');
  }

  if (targetWorkerId && !targetUserId) {
    const wRes = await query(`SELECT user_id FROM workers WHERE id = $1 AND company_id = $2`, [targetWorkerId, companyId]);
    if (wRes.rows[0]?.user_id) targetUserId = wRes.rows[0].user_id;
  } else if (targetUserId && !targetWorkerId) {
    const uRes = await query(`SELECT worker_id FROM users WHERE id = $1 AND company_id = $2`, [targetUserId, companyId]);
    if (uRes.rows[0]?.worker_id) targetWorkerId = uRes.rows[0].worker_id;
  }

  let worker = null;
  if (targetWorkerId) {
    const wRes = await query(`
      SELECT w.*,
             (SELECT crew_id FROM crew_workers cw WHERE cw.worker_id = w.id LIMIT 1) AS crew_id
      FROM workers w WHERE w.id = $1 AND w.company_id = $2 AND w.deleted_at IS NULL
    `, [targetWorkerId, companyId]);
    worker = wRes.rows[0] || null;
  }

  let user = null;
  if (targetUserId) {
    const uRes = await query(`
      SELECT u.*,
             (
               SELECT r.name FROM roles r
               JOIN user_roles ur ON ur.role_id = r.id
               WHERE ur.user_id = u.id LIMIT 1
             ) AS role_name,
             (
               SELECT r.id FROM roles r
               JOIN user_roles ur ON ur.role_id = r.id
               WHERE ur.user_id = u.id LIMIT 1
             ) AS role_id
      FROM users u WHERE u.id = $1 AND u.company_id = $2 AND u.deleted_at IS NULL
    `, [targetUserId, companyId]);
    user = uRes.rows[0] || null;
  }

  if (!worker && !user) {
    throw createHttpError(404, 'NOT_FOUND', 'No se encontró el trabajador ni el usuario.');
  }

  const lastNameParts = (user?.last_name || '').split(' ');

  const data = {
    sourceUserId: targetUserId || "",
    sourceWorkerId: targetWorkerId || "",
    missingFields: [],
    personalData: {
      dni: worker?.document_number || "",
      firstName: worker?.first_name || user?.first_name || "",
      paternalLastName: worker?.paternal_last_name || lastNameParts[0] || "",
      maternalLastName: worker?.maternal_last_name || lastNameParts.slice(1).join(' ') || "",
      phone: worker?.phone_number || "",
      personalEmail: worker?.personal_email || "",
      birthDate: worker?.birth_date ? toDateOnly(worker.birth_date) : "",
      gender: worker?.gender || "",
      civilStatus: worker?.civil_status || "",
      nationality: worker?.nationality || "Peruana",
      address: worker?.address || "",
      district: worker?.district || "",
      province: worker?.province || "",
      departmentId: worker?.department_id || "",
      emergencyContactName: worker?.emergency_contact_name || "",
      emergencyContactPhone: worker?.emergency_contact_phone || ""
    },
    laborData: {
      companyId: companyId,
      branchId: worker?.branch_id || "",
      departmentId: worker?.internal_department_id || "",
      areaId: worker?.area_id || "",
      positionId: worker?.position_id || worker?.job_position_id || "",
      workLocationId: worker?.work_location_id || "",
      workerTypeId: worker?.worker_type_id || "",
      shiftId: worker?.shift_id || "",
      startDate: worker?.hire_date ? toDateOnly(worker.hire_date) : "",
      supervisorId: worker?.supervisor_id || "",
      status: worker?.is_active ? "active" : "inactive"
    },
    contractData: {
      createContract: false,
      generateContract: true,
      contractType: worker?.contract_type || "",
      startDate: worker?.hire_date ? toDateOnly(worker.hire_date) : "",
      endDate: "",
      trialPeriod: true,
      salary: 0,
      currency: "PEN",
      workdayType: "full_time",
      workMode: "onsite",
      costCenterId: "",
      observations: ""
    },
    accessData: {
      createAccess: false,
      role: user?.role_name || "worker",
      roleId: user?.role_id || "",
      username: user?.username || "",
      corporateEmail: user?.email || "",
      temporaryPassword: "",
      forcePasswordChange: user?.force_password_change ?? true,
      sendCredentialsByEmail: true
    }
  };

  const reqLabor = ['departmentId', 'areaId', 'positionId', 'workLocationId'];
  reqLabor.forEach(f => {
    if (!data.laborData[f]) data.missingFields.push(`laborData.${f}`);
  });

  return data;
}

module.exports = {
  suggestCredentials,
  onboardWorker,
  getOnboardingStatus,
  getOnboardingPrefill,
  createHttpError
};
