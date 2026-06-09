function normalizeEmpty(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

function firstPresent(...values) {
  for (const value of values) {
    const normalized = normalizeEmpty(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function normalizeEmail(value) {
  const email = normalizeEmpty(value);
  return typeof email === 'string' ? email.toLowerCase() : email;
}

function normalizeWorkerStatus(value) {
  return String(value || 'active').trim().toLowerCase();
}

function splitFullName(fullName) {
  const normalized = normalizeEmpty(fullName);
  if (!normalized || typeof normalized !== 'string') {
    return { firstName: null, lastName: null };
  }

  const parts = normalized.split(/\s+/);
  return {
    firstName: parts[0] || null,
    lastName: parts.slice(1).join(' ') || null
  };
}

function normalizeWorkerPayload(payload = {}) {
  const hasNested = !!(
    payload.personalData || payload.personal_data || payload.personal ||
    payload.laborData || payload.labor_data || payload.labor
  );

  let personalInput;
  let laborInput;

  if (hasNested) {
    personalInput = payload.personalData || payload.personal_data || payload.personal || {};
    laborInput = payload.laborData || payload.labor_data || payload.labor || {};
  } else {
    personalInput = payload;
    laborInput = payload;
  }

  const fullName = firstPresent(personalInput.fullName, personalInput.full_name, personalInput.name);
  const nameParts = splitFullName(fullName);

  const firstName = firstPresent(personalInput.firstName, personalInput.first_name, nameParts.firstName);
  const lastName = firstPresent(
    personalInput.lastName,
    personalInput.last_name,
    personalInput.paternalLastName,
    personalInput.paternal_last_name,
    nameParts.lastName
  );
  const maternalLastName = firstPresent(personalInput.maternalLastName, personalInput.maternal_last_name);
  const documentNumber = firstPresent(personalInput.documentNumber, personalInput.document_number, personalInput.dni);
  const personalId = firstPresent(personalInput.personalId, personalInput.personal_id, documentNumber);
  const email = normalizeEmail(firstPresent(personalInput.email, personalInput.personalEmail, personalInput.personal_email));
  const startDate = firstPresent(laborInput.startDate, laborInput.start_date, laborInput.entryDate, laborInput.entry_date);

  // Geographic/personal department:
  // - If nested, look inside personalData: departmentId, department_id, geoDepartmentId, ubigeoDepartmentId
  // - If flat, look at root: geoDepartmentId, ubigeoDepartmentId (NOT departmentId/department_id, as they are organizational here)
  const personalDepartmentId = hasNested
    ? firstPresent(personalInput.departmentId, personalInput.department_id, personalInput.geoDepartmentId, personalInput.ubigeoDepartmentId)
    : firstPresent(payload.geoDepartmentId, payload.ubigeoDepartmentId);

  // Organizational/labor department:
  // - If nested, look inside laborData: departmentId, department_id, internal_department_id
  // - If flat, look at root: departmentId, department_id, internal_department_id
  const laborDepartmentId = firstPresent(laborInput.departmentId, laborInput.department_id, laborInput.internal_department_id);

  const personal = {
    firstName,
    lastName,
    paternalLastName: lastName,
    maternalLastName,
    fullName: firstPresent(fullName, [firstName, lastName, maternalLastName].filter(Boolean).join(' ')),
    email,
    phone: firstPresent(personalInput.phone, personalInput.phoneNumber, personalInput.phone_number),
    secondaryPhone: firstPresent(personalInput.secondaryPhone, personalInput.secondary_phone),
    documentNumber,
    personalId,
    dni: documentNumber,
    birthDate: firstPresent(personalInput.birthDate, personalInput.birth_date),
    gender: firstPresent(personalInput.gender),
    civilStatus: firstPresent(personalInput.civilStatus, personalInput.civil_status),
    nationality: firstPresent(personalInput.nationality),
    address: firstPresent(personalInput.address),
    district: firstPresent(personalInput.district),
    province: firstPresent(personalInput.province),
    department: firstPresent(personalInput.department),
    districtId: firstPresent(personalInput.districtId, personalInput.district_id),
    provinceId: firstPresent(personalInput.provinceId, personalInput.province_id),
    departmentId: personalDepartmentId,
    emergencyContactName: firstPresent(personalInput.emergencyContactName, personalInput.emergency_contact_name),
    emergencyContactPhone: firstPresent(personalInput.emergencyContactPhone, personalInput.emergency_contact_phone),
    emergencyContactRelationship: firstPresent(personalInput.emergencyContactRelationship, personalInput.emergency_contact_relationship, personalInput.parentesco)
  };

  const labor = {
    companyId: firstPresent(laborInput.companyId, laborInput.company_id),
    branchId: firstPresent(laborInput.branchId, laborInput.branch_id),
    departmentId: laborDepartmentId,
    areaId: firstPresent(laborInput.areaId, laborInput.area_id),
    positionId: firstPresent(laborInput.positionId, laborInput.position_id, laborInput.job_position_id),
    workLocationId: firstPresent(laborInput.workLocationId, laborInput.work_location_id),
    crewId: firstPresent(laborInput.crewId, laborInput.crew_id),
    workerTypeId: firstPresent(laborInput.workerTypeId, laborInput.worker_type_id),
    shiftId: firstPresent(laborInput.shiftId, laborInput.shift_id),
    supervisorId: firstPresent(laborInput.supervisorId, laborInput.supervisor_id),
    contractType: firstPresent(laborInput.contractType, laborInput.contract_type),
    startDate,
    entryDate: startDate,
    status: normalizeWorkerStatus(firstPresent(laborInput.status, laborInput.employment_status))
  };

  return {
    personal,
    labor,
    personalData: {
      dni: personal.documentNumber,
      firstName: personal.firstName,
      paternalLastName: personal.paternalLastName,
      maternalLastName: personal.maternalLastName,
      birthDate: personal.birthDate,
      gender: personal.gender,
      civilStatus: personal.civilStatus,
      nationality: personal.nationality,
      phone: personal.phone,
      secondaryPhone: personal.secondaryPhone,
      personalEmail: personal.email,
      address: personal.address,
      district: personal.district,
      province: personal.province,
      department: personal.department,
      districtId: personal.districtId,
      provinceId: personal.provinceId,
      departmentId: personal.departmentId,
      emergencyContactName: personal.emergencyContactName,
      emergencyContactPhone: personal.emergencyContactPhone,
      emergencyContactRelationship: personal.emergencyContactRelationship
    },
    laborData: {
      companyId: labor.companyId,
      branchId: labor.branchId,
      departmentId: labor.departmentId,
      areaId: labor.areaId,
      positionId: labor.positionId,
      workLocationId: labor.workLocationId,
      crewId: labor.crewId,
      workerTypeId: labor.workerTypeId,
      shiftId: labor.shiftId,
      supervisorId: labor.supervisorId,
      contractType: labor.contractType,
      startDate: labor.startDate,
      entryDate: labor.entryDate,
      status: labor.status
    }
  };
}

function normalizeCompleteProfilePayload(payload = {}) {
  return normalizeWorkerPayload(payload);
}

function withExisting(value, existingValue, preserveExisting) {
  const normalized = normalizeEmpty(value);
  if (normalized !== null) return normalized;
  return preserveExisting ? existingValue : null;
}

function buildWorkerPersistenceData(normalizedPayload, options = {}) {
  const { personalData, laborData } = normalizedPayload.personalData ? normalizedPayload : normalizeWorkerPayload(normalizedPayload);
  const {
    userId = undefined,
    creatorId = null,
    existingWorker = null,
    preserveExisting = false,
    onboardingStatus = undefined
  } = options;
  const employmentStatus = normalizeWorkerStatus(laborData.status);
  const existing = existingWorker || {};
  const documentNumber = withExisting(personalData.dni, existing.document_number, preserveExisting);

  const isValidUUID = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val));
  const deptIdInput = personalData.departmentId;
  const finalGeoDeptId = isValidUUID(deptIdInput)
    ? deptIdInput
    : (preserveExisting ? existing.department_id : null);

  return {
    user_id: userId === undefined ? undefined : userId,
    company_id: withExisting(laborData.companyId, existing.company_id, preserveExisting),
    document_type: 'DNI',
    document_number: documentNumber,
    personal_id: withExisting(personalData.dni, existing.personal_id || existing.document_number, preserveExisting),
    first_name: withExisting(personalData.firstName, existing.first_name, preserveExisting),
    paternal_last_name: withExisting(personalData.paternalLastName, existing.paternal_last_name, preserveExisting),
    maternal_last_name: withExisting(personalData.maternalLastName, existing.maternal_last_name, preserveExisting),
    birth_date: withExisting(personalData.birthDate, existing.birth_date, preserveExisting),
    gender: withExisting(personalData.gender, existing.gender, preserveExisting),
    civil_status: withExisting(personalData.civilStatus, existing.civil_status, preserveExisting),
    nationality: withExisting(personalData.nationality, existing.nationality, preserveExisting),
    phone_number: withExisting(personalData.phone, existing.phone_number, preserveExisting),
    secondary_phone: withExisting(personalData.secondaryPhone, existing.secondary_phone, preserveExisting),
    personal_email: withExisting(personalData.personalEmail, existing.personal_email, preserveExisting),
    address: withExisting(personalData.address, existing.address, preserveExisting),
    district: withExisting(personalData.district, existing.district, preserveExisting),
    province: withExisting(personalData.province, existing.province, preserveExisting),
    department: withExisting(personalData.department, existing.department, preserveExisting),
    district_id: withExisting(personalData.districtId, existing.district_id, preserveExisting),
    province_id: withExisting(personalData.provinceId, existing.province_id, preserveExisting),
    department_id: finalGeoDeptId,
    emergency_contact_name: withExisting(personalData.emergencyContactName, existing.emergency_contact_name, preserveExisting),
    emergency_contact_phone: withExisting(personalData.emergencyContactPhone, existing.emergency_contact_phone, preserveExisting),
    emergency_contact_relationship: withExisting(personalData.emergencyContactRelationship, existing.emergency_contact_relationship, preserveExisting),
    branch_id: withExisting(laborData.branchId, existing.branch_id, preserveExisting),
    area_id: withExisting(laborData.areaId, existing.area_id, preserveExisting),
    internal_department_id: withExisting(laborData.departmentId, existing.internal_department_id, preserveExisting),
    work_location_id: withExisting(laborData.workLocationId, existing.work_location_id, preserveExisting),
    position_id: withExisting(laborData.positionId, existing.position_id, preserveExisting),
    job_position_id: withExisting(laborData.positionId, existing.job_position_id, preserveExisting),
    worker_type_id: withExisting(laborData.workerTypeId, existing.worker_type_id, preserveExisting),
    shift_id: withExisting(laborData.shiftId, existing.shift_id, preserveExisting),
    contract_type: withExisting(laborData.contractType, existing.contract_type, preserveExisting),
    start_date: withExisting(laborData.startDate, existing.start_date, preserveExisting),
    hire_date: withExisting(laborData.startDate, existing.hire_date, preserveExisting),
    supervisor_id: withExisting(laborData.supervisorId, existing.supervisor_id, preserveExisting),
    status: employmentStatus === 'active' ? 'ACTIVE' : employmentStatus.toUpperCase(),
    employment_status: employmentStatus,
    is_active: employmentStatus === 'active',
    onboarding_status: onboardingStatus,
    created_by: creatorId === null ? undefined : creatorId
  };
}

module.exports = {
  normalizeEmpty,
  firstPresent,
  normalizeEmail,
  normalizeWorkerStatus,
  normalizeWorkerPayload,
  normalizeCompleteProfilePayload,
  buildWorkerPersistenceData
};
