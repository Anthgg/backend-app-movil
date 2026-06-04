const { UUID_REGEX, isValidUUID } = require('../../utils/uuid.util');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+()-\s]{6,20}$/;

const WORKER_TYPES = [
  { id: 'f5b7b9d7-8e6c-48c5-95df-3d6046e7f7b8', name: 'Planilla' },
  { id: 'c6c8e312-32ad-4d43-9828-d3f3f508a8f1', name: 'Recibo por Honorarios' },
  { id: '01fa9ea4-e50b-4171-8bc1-6ee0fa789f25', name: 'Practicante' }
];

const COST_CENTERS = [
  { id: '7422956f-87ee-45df-8b22-83563914a511', code: 'CC-OPER-01', name: 'Operaciones' },
  { id: '1a9992d9-1662-432d-862d-9610f443b7f1', code: 'CC-ADM-01', name: 'Administración' },
  { id: 'b8ee4ff5-f3ad-4e0f-8c38-89c0a6b7d1ef', code: 'CC-VEN-01', name: 'Ventas' }
];

function isValidDate(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function isUuid(value) {
  return isValidUUID(value);
}

function pushRequired(errors, field, value, message) {
  if (value === undefined || value === null || value === '') {
    errors.push({ field, message });
  }
}

function validateRequiredUuid(errors, field, value, requiredMessage) {
  if (value === undefined || value === null || value === '') {
    errors.push({ field, message: requiredMessage });
  } else if (!isUuid(value)) {
    errors.push({ field, message: `El campo ${field} debe ser un UUID válido.` });
  }
}

function validateOptionalUuid(errors, field, value) {
  if (value !== undefined && value !== null && value !== '') {
    if (!isUuid(value)) {
      errors.push({ field, message: `El campo ${field} debe ser un UUID válido.` });
    }
  }
}

function validatePersonalData(personalData = {}) {
  const errors = [];
  const dni = String(personalData.dni || '').trim();

  if (!/^\d{8}$/.test(dni)) {
    errors.push({ field: 'personalData.dni', message: 'El DNI debe tener 8 dígitos y solo números.' });
  }

  pushRequired(errors, 'personalData.firstName', personalData.firstName, 'El nombre es obligatorio.');
  pushRequired(errors, 'personalData.paternalLastName', personalData.paternalLastName, 'El apellido paterno es obligatorio.');

  if (personalData.personalEmail && !EMAIL_REGEX.test(personalData.personalEmail)) {
    errors.push({ field: 'personalData.personalEmail', message: 'El correo personal no tiene un formato válido.' });
  }

  if (personalData.phone && !PHONE_REGEX.test(personalData.phone)) {
    errors.push({ field: 'personalData.phone', message: 'El teléfono no tiene un formato válido.' });
  }

  if (personalData.secondaryPhone && !PHONE_REGEX.test(personalData.secondaryPhone)) {
    errors.push({ field: 'personalData.secondaryPhone', message: 'El teléfono secundario no tiene un formato válido.' });
  }

  if (personalData.birthDate && !isValidDate(personalData.birthDate)) {
    errors.push({ field: 'personalData.birthDate', message: 'La fecha de nacimiento no es válida.' });
  }

  validateOptionalUuid(errors, 'personalData.departmentId', personalData.departmentId || personalData.department_id);

  return errors;
}

function validateLaborData(laborData = {}, tenantId) {
  const errors = [];

  validateRequiredUuid(errors, 'laborData.companyId', laborData.companyId, 'La empresa es obligatoria.');
  validateRequiredUuid(errors, 'laborData.areaId', laborData.areaId, 'El área es obligatoria.');
  validateRequiredUuid(errors, 'laborData.positionId', laborData.positionId, 'El cargo es obligatorio.');
  
  pushRequired(errors, 'laborData.startDate', laborData.startDate, 'La fecha de inicio laboral es obligatoria.');
  if (laborData.startDate && !isValidDate(laborData.startDate)) {
    errors.push({ field: 'laborData.startDate', message: 'La fecha de inicio laboral no es válida.' });
  }

  validateOptionalUuid(errors, 'laborData.branchId', laborData.branchId);
  validateOptionalUuid(errors, 'laborData.workerTypeId', laborData.workerTypeId);
  validateOptionalUuid(errors, 'laborData.supervisorId', laborData.supervisorId);
  validateOptionalUuid(errors, 'laborData.departmentId', laborData.departmentId || laborData.department_id || laborData.internal_department_id);

  const requiresAttendance = laborData.requiresAttendance !== false;
  if (requiresAttendance) {
    validateRequiredUuid(errors, 'laborData.shiftId', laborData.shiftId, 'El turno es obligatorio para trabajadores con asistencia.');
  } else {
    validateOptionalUuid(errors, 'laborData.shiftId', laborData.shiftId);
  }

  return errors;
}

function validateContractData(contractData = {}) {
  if (contractData === null || contractData === undefined) {
    return [];
  }

  const shouldCreateContract = contractData.createContract !== false;
  if (!shouldCreateContract) {
    return [];
  }

  const errors = [];
  pushRequired(errors, 'contractData.contractType', contractData.contractType, 'El tipo de contrato es obligatorio.');
  pushRequired(errors, 'contractData.startDate', contractData.startDate, 'La fecha de inicio del contrato es obligatoria.');

  if (contractData.startDate && !isValidDate(contractData.startDate)) {
    errors.push({ field: 'contractData.startDate', message: 'La fecha de inicio del contrato no es válida.' });
  }

  if (contractData.endDate && !isValidDate(contractData.endDate)) {
    errors.push({ field: 'contractData.endDate', message: 'La fecha de fin del contrato no es válida.' });
  }

  if (contractData.startDate && contractData.endDate && new Date(contractData.endDate) <= new Date(contractData.startDate)) {
    errors.push({ field: 'contractData.endDate', message: 'La fecha de fin debe ser mayor a la fecha de inicio.' });
  }

  if (contractData.salary !== undefined && Number(contractData.salary) < 0) {
    errors.push({ field: 'contractData.salary', message: 'El sueldo debe ser mayor o igual a 0.' });
  }

  validateOptionalUuid(errors, 'contractData.costCenterId', contractData.costCenterId);

  return errors;
}

function validateAccessData(accessData = {}) {
  const errors = [];
  if (!accessData.createAccess) {
    return errors;
  }

  pushRequired(errors, 'accessData.role', accessData.role, 'El rol es obligatorio.');

  const corporateEmail = accessData.corporateEmail || accessData.corporate_email;
  if (corporateEmail && !EMAIL_REGEX.test(corporateEmail)) {
    errors.push({ field: 'accessData.corporateEmail', message: 'El correo corporativo no tiene un formato válido.' });
  }

  return errors;
}

function validateOnboardingPayload(payload = {}, tenantId) {
  const errors = [
    ...validatePersonalData(payload.personalData),
    ...validateLaborData(payload.laborData, tenantId),
    ...validateContractData(payload.contractData),
    ...validateAccessData(payload.accessData)
  ];

  return errors;
}

function validateCompleteProfilePayload(payload = {}, tenantId) {
  const errors = [];
  const hasNested = !!(
    payload.personalData || payload.personal_data || payload.personal ||
    payload.laborData || payload.labor_data || payload.labor
  );

  let personalData;
  let laborData;

  if (hasNested) {
    personalData = payload.personalData || payload.personal_data || payload.personal || {};
    laborData = payload.laborData || payload.labor_data || payload.labor || {};
  } else {
    personalData = payload;
    laborData = payload;
  }

  const companyId = laborData.companyId || laborData.company_id;
  const areaId = laborData.areaId || laborData.area_id;
  const positionId = laborData.positionId || laborData.position_id || laborData.job_position_id;
  const workLocationId = laborData.workLocationId || laborData.work_location_id;
  const startDate = laborData.startDate || laborData.start_date || laborData.entryDate || laborData.entry_date;
  const branchId = laborData.branchId || laborData.branch_id;
  const workerTypeId = laborData.workerTypeId || laborData.worker_type_id;
  const supervisorId = laborData.supervisorId || laborData.supervisor_id;
  const shiftId = laborData.shiftId || laborData.shift_id;
  const requiresAttendance = laborData.requiresAttendance !== false && laborData.requires_attendance !== false;

  const internalDeptId = laborData.departmentId || laborData.department_id || laborData.internal_department_id;
  const geoDeptId = hasNested
    ? (personalData.departmentId || personalData.department_id || personalData.geoDepartmentId || personalData.ubigeoDepartmentId)
    : (payload.geoDepartmentId || payload.ubigeoDepartmentId);

  validateRequiredUuid(errors, 'laborData.companyId', companyId, 'La empresa es obligatoria.');
  validateOptionalUuid(errors, 'laborData.areaId', areaId);
  validateOptionalUuid(errors, 'laborData.positionId', positionId);
  validateOptionalUuid(errors, 'laborData.workLocationId', workLocationId);
  validateOptionalUuid(errors, 'laborData.departmentId', internalDeptId);
  
  pushRequired(errors, 'laborData.startDate', startDate, 'La fecha de inicio laboral es obligatoria.');
  if (startDate && !isValidDate(startDate)) {
    errors.push({ field: 'laborData.startDate', message: 'La fecha de inicio laboral no es válida.' });
  }

  validateOptionalUuid(errors, 'laborData.branchId', branchId);
  validateOptionalUuid(errors, 'laborData.workerTypeId', workerTypeId);
  validateOptionalUuid(errors, 'laborData.supervisorId', supervisorId);

  if (requiresAttendance && shiftId) {
    validateOptionalUuid(errors, 'laborData.shiftId', shiftId);
  }

  validateOptionalUuid(errors, 'personalData.departmentId', geoDeptId);

  return errors;
}

module.exports = {
  EMAIL_REGEX,
  UUID_REGEX,
  isUuid,
  validateOnboardingPayload,
  validateCompleteProfilePayload,
  validatePersonalData,
  validateLaborData,
  validateContractData,
  validateAccessData,
  WORKER_TYPES,
  COST_CENTERS
};
