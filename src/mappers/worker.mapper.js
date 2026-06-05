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

function mapWorkerIdentity(row = null, fallbackUserId = null) {
  const workerId = isValidUUID(row?.id) ? row.id : null;
  const userId = isValidUUID(row?.user_id) ? row.user_id : (isValidUUID(fallbackUserId) ? fallbackUserId : null);

  if (!workerId) {
    return {
      id: null,
      worker_id: null,
      workerId: null,
      user_id: userId,
      userId,
      document_number: row?.document_number || null,
      personal_id: row?.personal_id || row?.document_number || null,
      profile_status: 'incomplete'
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
    profile_status: 'complete'
  };
}

function mapWorkerListItem(row = {}) {
  const mapped = mapWorkerIdentity(row, row.user_id);
  return {
    ...row,
    ...mapped,
    fullName: row.full_name,
    email: row.email
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
