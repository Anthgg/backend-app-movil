const { query, withTransaction } = require('../../config/database');
const { validateOnboardingPayload } = require('./validators');
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

async function usernameExists(companyId, username, db = { query }) {
  if (!username || !(await tableHasColumn('users', 'username', db))) {
    return false;
  }

  const result = await db.query(
    `SELECT id
     FROM users
     WHERE company_id = $1
       AND LOWER(username) = LOWER($2)
       AND deleted_at IS NULL
     LIMIT 1`,
    [companyId, username]
  );

  return result.rows.length > 0;
}

async function emailExists(companyId, email, db = { query }) {
  const result = await db.query(
    `SELECT id
     FROM users
     WHERE LOWER(email) = LOWER($1)
       AND (company_id = $2 OR company_id IS NULL)
       AND deleted_at IS NULL
     LIMIT 1`,
    [email, companyId]
  );

  return result.rows.length > 0;
}

async function assertDniIsAvailable(companyId, dni, db = { query }) {
  const result = await db.query(
    `SELECT id
     FROM workers
     WHERE company_id = $1
       AND document_number = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [companyId, dni]
  );

  if (result.rows.length > 0) {
    throw createHttpError(409, 'DNI_ALREADY_EXISTS', 'El DNI ya se encuentra registrado.', [
      { field: 'personalData.dni', message: 'El DNI ya se encuentra registrado.' }
    ]);
  }
}

async function assertUserCredentialsAvailable(companyId, accessData, db = { query }) {
  if (!accessData?.createAccess) {
    return;
  }

  const requestedUsername = accessData.username;
  const requestedCorporateEmail = accessData.corporateEmail || accessData.corporate_email;

  if (requestedUsername && await usernameExists(companyId, requestedUsername, db)) {
    throw createHttpError(409, 'USERNAME_ALREADY_EXISTS', 'El username ya se encuentra registrado.', [
      { field: 'accessData.username', message: 'El username ya se encuentra registrado.' }
    ]);
  }

  if (requestedCorporateEmail && await emailExists(companyId, requestedCorporateEmail, db)) {
    throw createHttpError(409, 'EMAIL_ALREADY_EXISTS', 'El correo corporativo ya se encuentra registrado.', [
      { field: 'accessData.corporateEmail', message: 'El correo corporativo ya se encuentra registrado.' }
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
    SELECT id, name
    FROM roles
    WHERE name = $1
      AND (company_id = $2 OR company_id IS NULL)
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
    temporary_password: generateTemporaryPassword(companyConfig?.nombre_comercial || companyConfig?.company_name || 'Fabryor'),
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
    department_id: laborData.areaId || null,
    position_id: laborData.positionId || null,
    job_position_id: laborData.positionId || null,
    worker_type_id: laborData.workerTypeId || null,
    shift_id: laborData.shiftId || null,
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

async function onboardWorker(payload, req) {
  assertAuthorized(req);

  const tenantId = req.tenantId;
  const validationErrors = validateOnboardingPayload(payload, tenantId);
  if (validationErrors.length > 0) {
    throw createHttpError(422, 'VALIDATION_FAILED', 'Hay errores de validacion en el alta de colaborador.', validationErrors);
  }

  const companyId = payload.laborData.companyId;
  assertTenant(companyId, tenantId);

  const warnings = [];
  let createdUserForEmail = null;
  let temporaryPasswordForEmail = null;
  let workerNameForEmail = null;
  let resultData = null;

  await assertDniIsAvailable(companyId, payload.personalData.dni);
  await assertUserCredentialsAvailable(companyId, payload.accessData || {});

  resultData = await withTransaction(async (client) => {
    try {
      const companyConfig = await getCompanyConfig(companyId, client);
      if (!companyConfig) {
        throw createHttpError(404, 'COMPANY_NOT_FOUND', 'Empresa no encontrada.');
      }

      const worker = await createWorkerRecord(client, payload, req.user.id);

      await logAuditEvent({
        db: client,
        userId: req.user.id,
        companyId,
        module: 'WORKERS',
        action: 'WORKER_CREATED',
        entity: 'workers',
        entityId: worker.id,
        newData: { dni: payload.personalData.dni },
        req
      });

      const contract = await createContractRecord(client, worker, payload.contractData || {}, companyId, req.user.id);
      if (contract) {
        await logAuditEvent({
          db: client,
          userId: req.user.id,
          companyId,
          module: 'CONTRACTS',
          action: 'CONTRACT_CREATED',
          entity: 'worker_contracts',
          entityId: contract.id,
          newData: { worker_id: worker.id, contract_type: payload.contractData?.contractType },
          req
        });
      }

      const access = await createAccessUser(client, worker, payload, companyConfig, req.user.id);
      if (access.user) {
        createdUserForEmail = access.user;
        temporaryPasswordForEmail = access.temporaryPassword;
        workerNameForEmail = [payload.personalData.firstName, payload.personalData.paternalLastName, payload.personalData.maternalLastName].filter(Boolean).join(' ');

        await logAuditEvent({
          db: client,
          userId: req.user.id,
          companyId,
          module: 'USERS',
          action: 'USER_CREATED',
          entity: 'users',
          entityId: access.user.id,
          newData: { username: access.user.username, email: access.user.email, role: access.user.role },
          req
        });
      }

      let generatedContract = null;
      if (contract && payload.contractData?.generateContract === true) {
        try {
          generatedContract = await contractService.generateContractPdf({
            db: client,
            companyId,
            contractId: contract.id,
            requestedBy: req.user.id,
            req
          });
        } catch (error) {
          if (payload.contractData?.requireGeneratedPdf === true) {
            throw error;
          }
          warnings.push('No se pudo generar el PDF del contrato.');
          await logAuditEvent({
            db: client,
            userId: req.user.id,
            companyId,
            module: 'ONBOARDING',
            action: 'ONBOARDING_WARNING',
            entity: 'workers',
            entityId: worker.id,
            newData: { warning: 'CONTRACT_GENERATE_FAILED', error: error.message },
            req
          });
        }
      }

      await updateReturning(client, 'workers', 'id', worker.id, {
        onboarding_status: warnings.length > 0 ? 'completed_with_warnings' : 'completed',
        updated_at: new Date()
      });

      await logAuditEvent({
        db: client,
        userId: req.user.id,
        companyId,
        module: 'ONBOARDING',
        action: 'ONBOARDING_COMPLETED',
        entity: 'workers',
        entityId: worker.id,
        newData: {
          worker_id: worker.id,
          user_id: access.user?.id || null,
          contract_id: contract?.id || null,
          warnings
        },
        metadata: getRequestMeta(req),
        req
      });

      return {
        worker_id: worker.id,
        user_id: access.user?.id || null,
        contract_id: contract?.id || null,
        contract_pdf_url: generatedContract?.pdf_url || null,
        temporary_password: access.user ? access.temporaryPassword : null,
        force_password_change: access.user?.force_password_change || null,
        warnings
      };
    } catch (error) {
      await logAuditEvent({
        db: client,
        userId: req.user.id,
        companyId,
        module: 'ONBOARDING',
        action: 'ONBOARDING_FAILED',
        entity: 'workers',
        entityId: null,
        newData: { code: error.errorCode || 'ONBOARDING_FAILED', message: error.message },
        req
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

module.exports = {
  suggestCredentials,
  onboardWorker,
  getOnboardingStatus,
  createHttpError
};
