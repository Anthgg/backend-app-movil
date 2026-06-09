const { isValidUUID } = require('../utils/uuid.util');

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function buildPendingDocumentNumber(userId) {
  const suffix = String(userId || '').replace(/-/g, '').slice(0, 5).toUpperCase() || '00000';
  return `PENDIENTE-${suffix}`;
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

function normalizeStatus(value, fallbackIsActive = null) {
  const status = firstPresent(value);
  if (status) return String(status).toLowerCase();
  if (fallbackIsActive === true) return 'active';
  if (fallbackIsActive === false) return 'inactive';
  return null;
}

function normalizeProfileComplete(value, profileStatus) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'complete'].includes(value.toLowerCase());
  }
  return profileStatus === 'complete';
}

function buildFullName(row = {}) {
  return firstPresent(
    row.fullName,
    row.full_name,
    [row.first_name, row.paternal_last_name, row.maternal_last_name].filter(Boolean).join(' '),
    [row.first_name, row.last_name].filter(Boolean).join(' ')
  );
}

function mapWorkerIdentity(row = null, fallbackUserId = null) {
  const workerId = isValidUUID(row?.id) ? row.id : null;
  const userId = isValidUUID(row?.user_id) ? row.user_id : (isValidUUID(fallbackUserId) ? fallbackUserId : null);
  const photoUrl = firstPresent(row?.profile_photo_url, row?.worker_profile_photo_url, row?.user_profile_photo_url);

  if (!workerId) {
    return {
      id: null,
      worker_id: null,
      workerId: null,
      user_id: userId,
      userId,
      document_number: row?.document_number || null,
      personal_id: row?.personal_id || row?.document_number || null,
      profile_status: 'incomplete',
      profile_photo_url: photoUrl,
      profilePhotoUrl: photoUrl,
      avatarUrl: photoUrl
    };
  }

  return {
    ...row,
    id: workerId,
    worker_id: workerId,
    workerId,
    user_id: userId,
    userId,
    document_number: row.document_number || null,
    personal_id: row.personal_id || null,
    profile_status: 'complete',
    profile_photo_url: photoUrl,
    profilePhotoUrl: photoUrl,
    avatarUrl: photoUrl
  };
}

function mapWorkerListItem(row = {}) {
  const workerId = isValidUUID(row.worker_id)
    ? row.worker_id
    : (isValidUUID(row.workerId) ? row.workerId : (isValidUUID(row.id) ? row.id : null));
  const userId = isValidUUID(row.user_id)
    ? row.user_id
    : (isValidUUID(row.userId) ? row.userId : null);
  const identityRow = {
    ...row,
    id: workerId,
    user_id: userId
  };
  const mapped = mapWorkerIdentity(identityRow, userId);
  const fullName = buildFullName(row);
  const documentNumber = firstPresent(row.documentNumber, row.document_number, row.personal_id);
  const email = firstPresent(row.email, row.personal_email);
  const phone = firstPresent(row.phone, row.phone_number);
  const positionId = firstPresent(row.positionId, row.position_id, row.job_position_id);
  const positionName = firstPresent(row.positionName, row.position_name, row.job_position_name);
  const areaId = firstPresent(row.areaId, row.area_id);
  const areaName = firstPresent(row.areaName, row.area_name);
  const internalDepartmentId = firstPresent(row.internalDepartmentId, row.internal_department_id);
  const internalDepartmentName = firstPresent(
    row.internalDepartmentName,
    row.internal_department_name,
    row.department_name
  );
  const workLocationId = firstPresent(row.workLocationId, row.work_location_id);
  const workLocationName = firstPresent(row.workLocationName, row.work_location_name);
  const crewId = firstPresent(row.crewId, row.crew_id);
  const crewName = firstPresent(row.crewName, row.crew_name);
  const roleId = firstPresent(row.roleId, row.role_id);
  const roleName = firstPresent(row.roleName, row.role_name);
  const roleCode = firstPresent(row.roleCode, row.role_code);
  const status = normalizeStatus(firstPresent(row.employment_status, row.status), row.is_active);
  const profileStatus = firstPresent(row.profileStatus, row.profile_status)
    || (workerId && areaId && positionId && workLocationId ? 'complete' : 'incomplete');
  const isProfileComplete = normalizeProfileComplete(
    firstPresent(row.isProfileComplete, row.is_profile_complete),
    profileStatus
  );

  const photoUrl = firstPresent(row.profile_photo_url, row.worker_profile_photo_url, row.user_profile_photo_url);

  return {
    ...row,
    ...mapped,
    profile_photo_url: photoUrl,
    profilePhotoUrl: photoUrl,
    avatarUrl: photoUrl,
    id: workerId,
    worker_id: workerId,
    workerId,
    user_id: userId,
    userId,
    full_name: fullName,
    fullName,
    document_number: documentNumber,
    documentNumber,
    personal_id: firstPresent(row.personal_id, documentNumber),
    email,
    phone,
    phone_number: phone,
    role_id: roleId,
    roleId,
    role_name: roleName,
    roleName,
    role_code: roleCode,
    roleCode,
    position_id: positionId,
    positionId,
    position_name: positionName,
    positionName,
    job_position_name: positionName,
    area_id: areaId,
    areaId,
    area_name: areaName,
    areaName,
    internal_department_id: internalDepartmentId,
    internalDepartmentId,
    internal_department_name: internalDepartmentName,
    internalDepartmentName,
    department_name: internalDepartmentName,
    work_location_id: workLocationId,
    workLocationId,
    work_location_name: workLocationName,
    workLocationName,
    crew_id: crewId,
    crewId,
    crew_name: crewName,
    crewName,
    status,
    profile_status: profileStatus,
    profileStatus,
    is_profile_complete: isProfileComplete,
    isProfileComplete,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
  };
}

function mapWorkerDetail(row = {}) {
  return mapWorkerListItem(row);
}

function mapCrewWorkerItem(row = {}) {
  const mapped = mapWorkerIdentity(row, row.user_id);
  return {
    ...row,
    ...mapped,
    worker_name: row.worker_name,
    worker_email: row.worker_email
  };
}

function getCompleteProfileMissingFields(worker, tenantId) {
  const missingFields = [];
  if (!tenantId) missingFields.push('laborData.companyId');
  if (!worker?.internal_department_id) missingFields.push('laborData.departmentId');
  if (!worker?.area_id) missingFields.push('laborData.areaId');
  if (!worker?.position_id && !worker?.job_position_id) missingFields.push('laborData.positionId');
  if (!worker?.work_location_id) missingFields.push('laborData.workLocationId');
  if (!worker?.hire_date && !worker?.start_date) missingFields.push('laborData.entryDate');
  return missingFields;
}

function mapUserRole(user = null) {
  const roleId = user?.role_id || user?.roleId || user?.role?.id || user?.role?.uuid || null;

  if (!roleId) {
    return null;
  }

  return {
    id: roleId,
    uuid: roleId,
    name: user?.role_name || user?.roleName || user?.role?.name || null,
    code: user?.role_code || user?.roleCode || user?.role?.code || null
  };
}

function mapCompleteProfileGetResponse({ user, worker, tenantId, catalogs }) {
  const workerIdentity = mapWorkerIdentity(worker, user?.id);
  const workerId = workerIdentity.worker_id;
  const userId = isValidUUID(user?.id) ? user.id : null;
  const documentNumber = worker?.document_number || buildPendingDocumentNumber(user?.id);
  const personalId = worker?.personal_id || documentNumber;
  const missingFields = getCompleteProfileMissingFields(worker, tenantId);
  const fullName = user?.full_name || `${user?.first_name || worker?.first_name || ''} ${user?.last_name || worker?.paternal_last_name || ''}`.trim();
  const role = mapUserRole(user);

  return {
    id: workerId,
    user_id: userId,
    userId,
    worker_id: workerId,
    workerId,
    document_number: documentNumber,
    personal_id: personalId,
    profile_status: workerId ? 'complete' : 'incomplete',
    missing_fields: missingFields,
    missingFields,
    user: {
      id: user?.id || null,
      user_id: userId,
      userId,
      worker_id: workerId,
      workerId,
      document_number: documentNumber,
      documentNumber,
      personal_id: personalId,
      personalId,
      first_name: user?.first_name || worker?.first_name || '',
      firstName: user?.first_name || worker?.first_name || '',
      last_name: user?.last_name || worker?.paternal_last_name || '',
      lastName: user?.last_name || worker?.paternal_last_name || '',
      full_name: fullName,
      fullName,
      email: worker?.personal_email || user?.email || '',
      username: user?.username || null,
      corporateEmail: user?.email || null,
      birth_date: worker?.birth_date ? toDateOnly(worker.birth_date) : '',
      birthDate: worker?.birth_date ? toDateOnly(worker.birth_date) : '',
      phone: worker?.phone_number || user?.phone || '',
      role_id: role?.id || null,
      roleId: role?.id || null,
      role,
      systemRole: role
    },
    worker: workerId ? workerIdentity : null,
    labor_data: {
      company_id: tenantId,
      department_id: worker?.internal_department_id || '',
      area_id: worker?.area_id || '',
      position_id: worker?.position_id || worker?.job_position_id || '',
      work_location_id: worker?.work_location_id || '',
      crew_id: worker?.crew_id || '',
      crewId: worker?.crew_id || '',
      crew_name: worker?.crew_name || '',
      crewName: worker?.crew_name || '',
      worker_type_id: worker?.worker_type_id || '',
      entry_date: worker?.hire_date ? toDateOnly(worker.hire_date) : '',
      status: worker?.is_active ? 'active' : 'inactive',
      shift_id: worker?.shift_id || '',
      supervisor_id: worker?.supervisor_id || ''
    },
    catalogs,
    meta: {
      catalog_strategy: 'prefetch',
      company_id: tenantId,
      has_existing_worker: !!workerId
    }
  };
}

function mapCompleteProfilePutResponse({ userId, worker }) {
  const mappedWorker = mapWorkerIdentity(worker, userId);
  return {
    id: mappedWorker.worker_id,
    user_id: mappedWorker.user_id,
    userId: mappedWorker.userId,
    worker_id: mappedWorker.worker_id,
    workerId: mappedWorker.workerId,
    document_number: mappedWorker.document_number,
    personal_id: mappedWorker.personal_id,
    crew_id: worker?.crew_id || null,
    crewId: worker?.crewId || worker?.crew_id || null,
    crew_name: worker?.crew_name || null,
    crewName: worker?.crewName || worker?.crew_name || null,
    work_location_id: worker?.work_location_id || null,
    workLocationId: worker?.work_location_id || null,
    profile_status: mappedWorker.profile_status,
    worker: mappedWorker.worker_id ? mappedWorker : null
  };
}

module.exports = {
  toDateOnly,
  buildPendingDocumentNumber,
  mapWorkerIdentity,
  mapWorkerListItem,
  mapWorkerDetail,
  mapCrewWorkerItem,
  getCompleteProfileMissingFields,
  mapUserRole,
  mapCompleteProfileGetResponse,
  mapCompleteProfilePutResponse
};
