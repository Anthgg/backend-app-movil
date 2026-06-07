const { query, withTransaction } = require('../../config/database');
const { getWorkerShift } = require('../attendance-service/services/mobile-attendance.service');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERU_PHONE_REGEX = /^9\d{8}$/;

function hasOwn(data, key) {
  return Object.prototype.hasOwnProperty.call(data || {}, key);
}

function normalizeEmpty(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function firstPresent(...values) {
  for (const value of values) {
    const normalized = normalizeEmpty(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function firstProvided(data, keys) {
  for (const key of keys) {
    if (hasOwn(data, key)) {
      return data[key];
    }
  }
  return undefined;
}

function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.toISOString();
}

function formatTimeOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 5);
  }

  return value.toISOString().slice(11, 16);
}

function normalizeRole(roles = [], row = {}) {
  const primary = firstPresent(row.role_code, row.role_name, roles[0], 'WORKER');
  const upper = String(primary).toUpperCase();
  const map = {
    TRABAJADOR: 'worker',
    WORKER: 'worker',
    ADMIN: 'admin',
    ADMINISTRADOR: 'admin',
    RRHH: 'rrhh',
    SUPERVISOR: 'supervisor'
  };
  return map[upper] || String(primary).toLowerCase();
}

function normalizeStatus(value, fallbackIsActive = null) {
  const status = firstPresent(value);
  if (status) return String(status).toLowerCase();
  if (fallbackIsActive === true) return 'active';
  if (fallbackIsActive === false) return 'inactive';
  return null;
}

function buildName(...parts) {
  const name = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return name || null;
}

function splitFullName(fullName) {
  const normalized = normalizeEmpty(fullName);
  if (!normalized) {
    return { firstName: null, lastName: null };
  }

  const parts = normalized.split(/\s+/);
  return {
    firstName: parts[0] || null,
    lastName: parts.slice(1).join(' ') || null
  };
}

function appendUpdateField(fields, values, column, value) {
  if (value === undefined) {
    return;
  }

  values.push(value === '' ? null : value);
  fields.push(`${column} = $${values.length}`);
}

function mapActionLabel(action) {
  const normalized = String(action || '').toUpperCase();
  const labels = {
    LOGIN: 'Inicio de sesion',
    LOGOUT: 'Cierre de sesion',
    UPDATE: 'Actualizacion',
    PROFILE_UPDATE: 'Actualizacion de perfil',
    UPLOAD_PHOTO: 'Foto actualizada',
    DELETE_PHOTO: 'Foto eliminada',
    CHANGE_PASSWORD: 'Cambio de contrasena',
    EXPORT_PDF: 'Exportacion PDF'
  };
  return labels[normalized] || String(action || 'Actividad');
}

function serializeActivity(rows = []) {
  return rows.map((row) => {
    const actionLabel = mapActionLabel(row.action);
    const moduleName = row.module || row.entity || 'Sistema';

    return {
      id: row.id,
      type: String(row.action || '').toLowerCase(),
      action: row.action,
      actionLabel,
      module: row.module,
      scope: row.module,
      entity: row.entity,
      entityId: row.entity_id,
      description: `${actionLabel} en ${moduleName}`,
      actorName: row.actor_name || null,
      ipAddress: row.ip_address || null,
      userAgent: row.user_agent || null,
      metadata: row.new_data || null,
      createdAt: formatDateTime(row.created_at),
      timestamp: formatDateTime(row.created_at)
    };
  });
}

function buildSecurity(row, activeSessions) {
  const passwordChangeRequired = row.force_password_change === true;
  const lastPasswordChangeAt = formatDateTime(row.last_password_change_at);

  return {
    email_verified: true,
    emailVerified: true,
    password_change_required: passwordChangeRequired,
    passwordChangeRequired,
    active_sessions: activeSessions,
    activeSessions,
    failed_login_attempts: 0,
    failedLoginAttempts: 0,
    last_password_change_at: lastPasswordChangeAt,
    lastPasswordChangeAt
  };
}

function serializeWorker(row, shift) {
  if (!row.worker_id) {
    return null;
  }

  const workerFullName = firstPresent(
    row.worker_full_name,
    buildName(row.worker_first_name, row.paternal_last_name, row.maternal_last_name),
    row.user_full_name
  );
  const documentNumber = firstPresent(row.document_number, row.personal_id);
  const phone = firstPresent(row.phone_number);
  const hireDate = formatDateOnly(firstPresent(row.hire_date, row.start_date));
  const laborStatus = normalizeStatus(firstPresent(row.employment_status, row.worker_status), row.worker_is_active);
  const positionId = firstPresent(row.position_id, row.job_position_id);
  const positionName = firstPresent(row.position_name);
  const departmentId = firstPresent(row.internal_department_id);
  const departmentName = firstPresent(row.internal_department_name);
  const workerType = firstPresent(row.worker_type, row.employment_type, row.contract_type);
  const modality = firstPresent(row.modality, row.employment_type, row.contract_type);
  const supervisorId = firstPresent(row.supervisor_id, row.crew_supervisor_id);
  const supervisorName = firstPresent(row.supervisor_name, row.crew_supervisor_name);
  const shiftName = firstPresent(shift?.name, row.shift_name);

  return {
    id: row.worker_id,
    worker_id: row.worker_id,
    workerId: row.worker_id,
    user_id: row.user_id,
    userId: row.user_id,
    full_name: workerFullName,
    fullName: workerFullName,
    first_name: row.worker_first_name || null,
    firstName: row.worker_first_name || null,
    paternal_last_name: row.paternal_last_name || null,
    paternalLastName: row.paternal_last_name || null,
    maternal_last_name: row.maternal_last_name || null,
    maternalLastName: row.maternal_last_name || null,
    document_type: row.document_type || null,
    documentType: row.document_type || null,
    document_number: documentNumber,
    documentNumber,
    personal_id: firstPresent(row.personal_id, documentNumber),
    personalId: firstPresent(row.personal_id, documentNumber),
    phone_number: phone,
    phoneNumber: phone,
    phone,
    secondary_phone: row.secondary_phone || null,
    secondaryPhone: row.secondary_phone || null,
    personal_email: row.personal_email || null,
    personalEmail: row.personal_email || null,
    birth_date: formatDateOnly(row.birth_date),
    birthDate: formatDateOnly(row.birth_date),
    gender: row.gender || null,
    civil_status: row.civil_status || null,
    civilStatus: row.civil_status || null,
    nationality: row.nationality || null,
    address: row.address || null,
    province: row.province || null,
    district: row.district || null,
    department: row.geo_department || null,
    emergency_contact_name: row.emergency_contact_name || null,
    emergencyContactName: row.emergency_contact_name || null,
    emergency_contact_phone: row.emergency_contact_phone || null,
    emergencyContactPhone: row.emergency_contact_phone || null,
    emergency_contact_relationship: null,
    emergencyContactRelationship: null,
    company_id: row.worker_company_id || row.company_id || null,
    companyId: row.worker_company_id || row.company_id || null,
    company_name: row.company_name || null,
    companyName: row.company_name || null,
    position_id: positionId,
    positionId,
    job_position_id: row.job_position_id || null,
    jobPositionId: row.job_position_id || null,
    position_name: positionName,
    positionName,
    job_position_name: positionName,
    jobPositionName: positionName,
    area_id: row.area_id || null,
    areaId: row.area_id || null,
    area_name: row.area_name || null,
    areaName: row.area_name || null,
    internal_department_id: departmentId,
    internalDepartmentId: departmentId,
    internal_department_name: departmentName,
    internalDepartmentName: departmentName,
    department_name: departmentName,
    departmentName,
    work_location_id: row.work_location_id || null,
    workLocationId: row.work_location_id || null,
    work_location_name: row.work_location_name || null,
    workLocationName: row.work_location_name || null,
    work_location_address: row.work_location_address || null,
    workLocationAddress: row.work_location_address || null,
    attendance_radius: row.allowed_radius_meters ?? null,
    attendanceRadius: row.allowed_radius_meters ?? null,
    crew_id: row.crew_id || null,
    crewId: row.crew_id || null,
    crew_name: row.crew_name || null,
    crewName: row.crew_name || null,
    supervisor_id: supervisorId,
    supervisorId,
    supervisor_name: supervisorName,
    supervisorName,
    hire_date: hireDate,
    hireDate,
    entry_date: hireDate,
    entryDate: hireDate,
    start_date: formatDateOnly(row.start_date),
    startDate: formatDateOnly(row.start_date),
    labor_status: laborStatus,
    laborStatus,
    status: laborStatus,
    worker_type_id: row.worker_type_id || null,
    workerTypeId: row.worker_type_id || null,
    worker_type: workerType,
    workerType,
    branch_id: row.branch_id || null,
    branchId: row.branch_id || null,
    branch_name: row.branch_name || null,
    branchName: row.branch_name || null,
    shift_id: firstPresent(shift?.id, row.shift_id),
    shiftId: firstPresent(shift?.id, row.shift_id),
    shift_name: shiftName,
    shiftName,
    shift,
    modality,
    cost_center: null,
    costCenter: null,
    employment_type: row.employment_type || null,
    employmentType: row.employment_type || null,
    contract_type: row.contract_type || null,
    contractType: row.contract_type || null,
    created_at: formatDateTime(row.worker_created_at),
    createdAt: formatDateTime(row.worker_created_at),
    updated_at: formatDateTime(row.worker_updated_at),
    updatedAt: formatDateTime(row.worker_updated_at)
  };
}

function serializeProfile(row, roles = [], extras = {}) {
  const shift = extras.shift || null;
  const activity = extras.activity || [];
  const security = buildSecurity(row, extras.activeSessions || 0);
  const worker = serializeWorker(row, shift);
  const fullName = firstPresent(row.user_full_name, worker?.fullName, buildName(row.user_first_name, row.user_last_name));
  const roleName = firstPresent(row.role_name, roles[0]);
  const roleCode = firstPresent(row.role_code, roleName);
  const role = normalizeRole(roles, row);
  const profilePhotoUrl = firstPresent(row.worker_profile_photo_url, row.user_profile_photo_url);
  const lastLoginAt = formatDateTime(row.last_login_at);
  const userStatus = normalizeStatus(row.user_status, row.user_is_active);

  const user = {
    id: row.user_id,
    user_id: row.user_id,
    userId: row.user_id,
    worker_id: row.worker_id || null,
    workerId: row.worker_id || null,
    full_name: fullName,
    fullName,
    first_name: row.user_first_name || null,
    firstName: row.user_first_name || null,
    last_name: row.user_last_name || null,
    lastName: row.user_last_name || null,
    email: row.email || null,
    username: row.username || null,
    status: userStatus,
    is_active: row.user_is_active === true,
    isActive: row.user_is_active === true,
    role,
    role_id: row.role_id || null,
    roleId: row.role_id || null,
    role_name: roleName,
    roleName,
    role_code: roleCode,
    roleCode,
    company_id: row.company_id || null,
    companyId: row.company_id || null,
    company_name: row.company_name || null,
    companyName: row.company_name || null,
    profile_photo_url: profilePhotoUrl,
    profilePhotoUrl,
    avatarUrl: profilePhotoUrl,
    last_login_at: lastLoginAt,
    lastLoginAt,
    created_at: formatDateTime(row.user_created_at),
    createdAt: formatDateTime(row.user_created_at),
    updated_at: formatDateTime(row.user_updated_at),
    updatedAt: formatDateTime(row.user_updated_at),
    security
  };

  return {
    id: row.user_id,
    userId: row.user_id,
    workerId: row.worker_id || null,
    fullName,
    full_name: fullName,
    email: row.email || null,
    username: row.username || null,
    role,
    roleId: row.role_id || null,
    roleName,
    roleCode,
    position: worker?.positionName || null,
    company: row.company_name || null,
    profilePhotoUrl,
    avatarUrl: profilePhotoUrl,
    phone: worker?.phone || null,
    secondaryPhone: worker?.secondaryPhone || null,
    personalEmail: worker?.personalEmail || null,
    birthDate: worker?.birthDate || null,
    address: worker?.address || null,
    emergencyContactName: worker?.emergencyContactName || null,
    emergencyContactPhone: worker?.emergencyContactPhone || null,
    emergencyContactRelationship: worker?.emergencyContactRelationship || null,
    shift,
    shiftName: shift?.name || worker?.shiftName || null,
    lastLoginAt,
    last_login_at: lastLoginAt,
    status: userStatus,
    user,
    worker,
    security,
    activity,
    audit_logs: activity,
    auditLogs: activity,
    roles,
    permissions: []
  };
}

async function getProfileRow(userId, tenantId) {
  const result = await query(`
    SELECT
      u.id AS user_id,
      u.email,
      u.username,
      u.first_name AS user_first_name,
      u.last_name AS user_last_name,
      COALESCE(NULLIF(u.full_name, ''), NULLIF(CONCAT_WS(' ', u.first_name, u.last_name), '')) AS user_full_name,
      u.status AS user_status,
      u.is_active AS user_is_active,
      u.profile_photo_url AS user_profile_photo_url,
      u.last_login_at,
      u.force_password_change,
      u.last_password_change_at,
      u.created_at AS user_created_at,
      u.updated_at AS user_updated_at,
      u.company_id,
      w.id AS worker_id,
      w.document_type,
      w.document_number,
      w.personal_id,
      w.first_name AS worker_first_name,
      w.paternal_last_name,
      w.maternal_last_name,
      NULLIF(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name), '') AS worker_full_name,
      w.phone_number,
      w.secondary_phone,
      w.personal_email,
      w.birth_date,
      w.gender,
      w.civil_status,
      w.nationality,
      w.address,
      w.province,
      w.district,
      w.department AS geo_department,
      w.emergency_contact_name,
      w.emergency_contact_phone,
      w.profile_photo_url AS worker_profile_photo_url,
      w.company_id AS worker_company_id,
      w.hire_date,
      w.start_date,
      w.status AS worker_status,
      w.employment_status,
      w.is_active AS worker_is_active,
      w.employment_type,
      w.contract_type,
      w.branch_id,
      w.worker_type_id,
      w.shift_id,
      w.area_id,
      w.internal_department_id,
      w.work_location_id,
      w.supervisor_id,
      w.job_position_id,
      w.position_id,
      w.created_at AS worker_created_at,
      w.updated_at AS worker_updated_at,
      role_data.role_id,
      role_data.role_name,
      role_data.role_code,
      jp.name AS position_name,
      jp.code AS position_code,
      c.name AS company_name,
      a.name AS area_name,
      d.name AS internal_department_name,
      branch.name AS branch_name,
      wl.name AS work_location_name,
      wl.address AS work_location_address,
      wl.allowed_radius_meters,
      s.name AS shift_name,
      s.start_time AS shift_start,
      s.end_time AS shift_end,
      s.tolerance_minutes AS shift_tolerance,
      NULLIF(COALESCE(NULLIF(supervisor.full_name, ''), CONCAT_WS(' ', supervisor.first_name, supervisor.last_name)), '') AS supervisor_name,
      crew_data.crew_id,
      crew_data.crew_name,
      crew_data.crew_supervisor_id,
      crew_data.crew_supervisor_name
    FROM users u
    LEFT JOIN LATERAL (
      SELECT worker_row.*
      FROM workers worker_row
      WHERE worker_row.company_id = u.company_id
        AND worker_row.deleted_at IS NULL
        AND (worker_row.user_id = u.id OR worker_row.id = u.worker_id)
      ORDER BY CASE WHEN worker_row.id = u.worker_id THEN 0 ELSE 1 END,
               worker_row.updated_at DESC NULLS LAST,
               worker_row.created_at DESC NULLS LAST
      LIMIT 1
    ) w ON TRUE
    LEFT JOIN LATERAL (
      SELECT r.id AS role_id,
             r.name AS role_name,
             r.code AS role_code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
        AND r.deleted_at IS NULL
        AND COALESCE(r.is_active, TRUE) = TRUE
        AND (r.company_id = u.company_id OR r.company_id IS NULL)
      ORDER BY CASE WHEN r.company_id = u.company_id THEN 0 ELSE 1 END,
               r.created_at ASC NULLS LAST
      LIMIT 1
    ) role_data ON TRUE
    LEFT JOIN companies c
      ON c.id = u.company_id
    LEFT JOIN job_positions jp
      ON jp.id = COALESCE(w.position_id, w.job_position_id)
     AND jp.deleted_at IS NULL
     AND (jp.company_id = u.company_id OR jp.company_id IS NULL)
    LEFT JOIN areas a
      ON a.id = w.area_id
     AND a.deleted_at IS NULL
     AND (a.company_id = u.company_id OR a.company_id IS NULL)
    LEFT JOIN departments d
      ON d.id = w.internal_department_id
     AND d.deleted_at IS NULL
     AND d.company_id = u.company_id
    LEFT JOIN projects branch
      ON branch.id = w.branch_id
     AND branch.deleted_at IS NULL
     AND branch.company_id = u.company_id
    LEFT JOIN work_locations wl
      ON wl.id = w.work_location_id
     AND wl.deleted_at IS NULL
     AND wl.company_id = u.company_id
    LEFT JOIN shifts s
      ON s.id = w.shift_id
     AND s.company_id = u.company_id
    LEFT JOIN users supervisor
      ON supervisor.id = w.supervisor_id
     AND supervisor.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT resolved.crew_id,
             resolved.crew_name,
             resolved.crew_supervisor_id,
             resolved.crew_supervisor_name
      FROM (
        SELECT cw.crew_id,
               wc.name AS crew_name,
               wc.supervisor_id AS crew_supervisor_id,
               NULLIF(COALESCE(NULLIF(su.full_name, ''), CONCAT_WS(' ', su.first_name, su.last_name)), '') AS crew_supervisor_name,
               0 AS priority,
               cw.assigned_at,
               cw.created_at
        FROM crew_workers cw
        JOIN work_crews wc
          ON wc.id = cw.crew_id
         AND wc.company_id = cw.company_id
         AND wc.deleted_at IS NULL
         AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
        LEFT JOIN users su
          ON su.id = wc.supervisor_id
         AND su.deleted_at IS NULL
        WHERE cw.worker_id = w.id
          AND cw.company_id = w.company_id
          AND cw.is_active = TRUE
          AND cw.unassigned_at IS NULL

        UNION ALL

        SELECT fallback_wc.id AS crew_id,
               fallback_wc.name AS crew_name,
               fallback_wc.supervisor_id AS crew_supervisor_id,
               NULLIF(COALESCE(NULLIF(fallback_su.full_name, ''), CONCAT_WS(' ', fallback_su.first_name, fallback_su.last_name)), '') AS crew_supervisor_name,
               1 AS priority,
               fallback_wc.created_at AS assigned_at,
               fallback_wc.created_at
        FROM work_crews fallback_wc
        LEFT JOIN users fallback_su
          ON fallback_su.id = fallback_wc.supervisor_id
         AND fallback_su.deleted_at IS NULL
        WHERE fallback_wc.company_id = w.company_id
          AND fallback_wc.work_location_id = w.work_location_id
          AND fallback_wc.deleted_at IS NULL
          AND COALESCE(fallback_wc.is_active, fallback_wc.status, TRUE) = TRUE
          AND NOT EXISTS (
            SELECT 1
            FROM crew_workers existing_cw
            WHERE existing_cw.worker_id = w.id
              AND existing_cw.company_id = w.company_id
              AND existing_cw.is_active = TRUE
              AND existing_cw.unassigned_at IS NULL
          )
          AND (
            SELECT COUNT(*)::int
            FROM work_crews unique_wc
            WHERE unique_wc.company_id = w.company_id
              AND unique_wc.work_location_id = w.work_location_id
              AND unique_wc.deleted_at IS NULL
              AND COALESCE(unique_wc.is_active, unique_wc.status, TRUE) = TRUE
          ) = 1
      ) resolved
      ORDER BY resolved.priority ASC,
               resolved.assigned_at DESC NULLS LAST,
               resolved.created_at DESC NULLS LAST
      LIMIT 1
    ) crew_data ON TRUE
    WHERE u.id = $1
      AND u.company_id = $2
      AND u.deleted_at IS NULL
    LIMIT 1
  `, [userId, tenantId]);

  return result.rows[0] || null;
}

async function getActiveSessions(userId, tenantId) {
  const result = await query(`
    SELECT COUNT(*)::int AS active_sessions
    FROM user_devices
    WHERE user_id = $1
      AND company_id = $2
      AND COALESCE(is_active, TRUE) = TRUE
      AND COALESCE(is_blocked, FALSE) = FALSE
      AND revoked_at IS NULL
  `, [userId, tenantId]);

  return Math.max(1, Number(result.rows[0]?.active_sessions || 0));
}

async function getRecentActivity(userId, tenantId, workerId) {
  const result = await query(`
    SELECT al.id,
           al.module,
           al.action,
           al.entity,
           al.entity_id,
           al.new_data,
           al.ip_address,
           al.user_agent,
           al.created_at,
           NULLIF(COALESCE(NULLIF(actor.full_name, ''), CONCAT_WS(' ', actor.first_name, actor.last_name)), '') AS actor_name
    FROM audit_logs al
    LEFT JOIN users actor ON actor.id = al.user_id
    WHERE (al.company_id = $2 OR al.company_id IS NULL)
      AND (
        al.user_id = $1
        OR al.entity_id = $1
        OR ($3::uuid IS NOT NULL AND al.entity_id = $3::uuid)
      )
    ORDER BY al.created_at DESC
    LIMIT 10
  `, [userId, tenantId, workerId || null]);

  return serializeActivity(result.rows);
}

function validatePatch(data) {
  const phone = firstProvided(data, ['phone', 'phoneNumber', 'phone_number']);
  const secondaryPhone = firstProvided(data, ['secondaryPhone', 'secondary_phone']);
  const emergencyContactPhone = firstProvided(data, ['emergencyContactPhone', 'emergency_contact_phone']);
  const personalEmail = firstProvided(data, ['personalEmail', 'personal_email']);
  const birthDate = firstProvided(data, ['birthDate', 'birth_date']);

  for (const [field, value, code] of [
    ['El celular', phone, 'INVALID_PHONE'],
    ['El celular secundario', secondaryPhone, 'INVALID_SECONDARY_PHONE'],
    ['El celular de emergencia', emergencyContactPhone, 'INVALID_EMERGENCY_PHONE']
  ]) {
    if (value !== undefined && value !== null && value !== '' && !PERU_PHONE_REGEX.test(String(value))) {
      const err = new Error(`${field} debe ser peruano y tener 9 digitos.`);
      err.statusCode = 400;
      err.errorCode = code;
      throw err;
    }
  }

  if (personalEmail !== undefined && personalEmail !== null && personalEmail !== '' && !EMAIL_REGEX.test(String(personalEmail))) {
    const err = new Error('Correo invalido.');
    err.statusCode = 400;
    err.errorCode = 'INVALID_EMAIL';
    throw err;
  }

  if (birthDate) {
    const parsed = new Date(birthDate);
    if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
      const err = new Error('La fecha de nacimiento no puede ser futura.');
      err.statusCode = 400;
      err.errorCode = 'INVALID_BIRTH_DATE';
      throw err;
    }
  }
}

class ProfileService {
  async getProfile(userId, tenantId, roles = []) {
    const row = await getProfileRow(userId, tenantId);

    if (!row) {
      const err = new Error('Usuario no encontrado.');
      err.statusCode = 404;
      throw err;
    }

    const [shift, activeSessions, activity] = await Promise.all([
      row.worker_id ? getWorkerShift(row.worker_id, tenantId) : Promise.resolve(row.shift_id ? {
        id: row.shift_id,
        name: row.shift_name,
        startTime: formatTimeOnly(row.shift_start),
        endTime: formatTimeOnly(row.shift_end),
        toleranceMinutes: Number(row.shift_tolerance || 0)
      } : null),
      getActiveSessions(userId, tenantId),
      getRecentActivity(userId, tenantId, row.worker_id)
    ]);

    return serializeProfile(row, roles, { shift, activeSessions, activity });
  }

  async getMyShift(userId, tenantId) {
    const row = await getProfileRow(userId, tenantId);

    if (!row) {
      const err = new Error('Usuario no encontrado.');
      err.statusCode = 404;
      throw err;
    }

    return row.worker_id ? await getWorkerShift(row.worker_id, tenantId) : null;
  }

  async updateProfile(userId, tenantId, data, roles = []) {
    validatePatch(data);

    const userFullName = firstProvided(data, ['fullName', 'full_name', 'name']);
    const { firstName, lastName } = splitFullName(userFullName);

    const workerPatch = {
      phone_number: firstProvided(data, ['phone', 'phoneNumber', 'phone_number']),
      secondary_phone: firstProvided(data, ['secondaryPhone', 'secondary_phone']),
      personal_email: firstProvided(data, ['personalEmail', 'personal_email']),
      birth_date: firstProvided(data, ['birthDate', 'birth_date']),
      address: firstProvided(data, ['address']),
      province: firstProvided(data, ['province']),
      district: firstProvided(data, ['district']),
      department: firstProvided(data, ['department', 'geoDepartment', 'geo_department']),
      emergency_contact_name: firstProvided(data, ['emergencyContactName', 'emergency_contact_name']),
      emergency_contact_phone: firstProvided(data, ['emergencyContactPhone', 'emergency_contact_phone'])
    };

    await withTransaction(async (client) => {
      const userFields = [];
      const userValues = [];

      if (userFullName !== undefined) {
        appendUpdateField(userFields, userValues, 'full_name', normalizeEmpty(userFullName));
        appendUpdateField(userFields, userValues, 'first_name', firstName);
        appendUpdateField(userFields, userValues, 'last_name', lastName);
      }

      if (userFields.length > 0) {
        userValues.push(userId, tenantId);
        await client.query(`
          UPDATE users
          SET ${userFields.join(', ')},
              updated_at = NOW()
          WHERE id = $${userValues.length - 1}
            AND company_id = $${userValues.length}
            AND deleted_at IS NULL
        `, userValues);
      }

      const workerFields = [];
      const workerValues = [];
      Object.entries(workerPatch).forEach(([column, value]) => {
        appendUpdateField(workerFields, workerValues, column, value);
      });

      if (workerFields.length === 0) {
        return;
      }

      workerValues.push(userId, tenantId);
      const updated = await client.query(`
        UPDATE workers
        SET ${workerFields.join(', ')},
            updated_at = NOW()
        WHERE company_id = $${workerValues.length}
          AND deleted_at IS NULL
          AND (
            user_id = $${workerValues.length - 1}
            OR id = (SELECT worker_id FROM users WHERE id = $${workerValues.length - 1} AND company_id = $${workerValues.length})
          )
        RETURNING user_id
      `, workerValues);

      if (updated.rows.length === 0) {
        const err = new Error('No tienes un perfil de trabajador activo asociado.');
        err.statusCode = 403;
        err.errorCode = 'WORKER_PROFILE_REQUIRED';
        throw err;
      }
    });

    return this.getProfile(userId, tenantId, roles);
  }

  async updatePhoto(userId, tenantId, photoUrl, roles = []) {
    const workerResult = await query(`
      UPDATE workers
      SET profile_photo_url = $1,
          updated_at = NOW()
      WHERE user_id = $2
        AND company_id = $3
        AND deleted_at IS NULL
      RETURNING user_id
    `, [photoUrl, userId, tenantId]);

    if (workerResult.rows.length === 0) {
      const userResult = await query(`
        UPDATE users
        SET profile_photo_url = $1,
            updated_at = NOW()
        WHERE id = $2
          AND company_id = $3
          AND deleted_at IS NULL
        RETURNING id
      `, [photoUrl, userId, tenantId]);

      if (userResult.rows.length === 0) {
        const err = new Error('No tienes un perfil de usuario activo asociado.');
        err.statusCode = 403;
        err.errorCode = 'USER_PROFILE_REQUIRED';
        throw err;
      }
    }

    return this.getProfile(userId, tenantId, roles);
  }

  async deletePhoto(userId, tenantId) {
    const workerResult = await query(`
      UPDATE workers
      SET profile_photo_url = NULL,
          updated_at = NOW()
      WHERE user_id = $1
        AND company_id = $2
        AND deleted_at IS NULL
      RETURNING user_id
    `, [userId, tenantId]);

    if (workerResult.rows.length === 0) {
      const userResult = await query(`
        UPDATE users
        SET profile_photo_url = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND company_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `, [userId, tenantId]);

      if (userResult.rows.length === 0) {
        const err = new Error('No tienes un perfil de usuario activo asociado.');
        err.statusCode = 403;
        err.errorCode = 'USER_PROFILE_REQUIRED';
        throw err;
      }
    }

    return { success: true };
  }
}

module.exports = new ProfileService();
