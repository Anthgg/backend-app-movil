const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+()\-\s]{6,20}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidDate(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function isUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

function pushRequired(errors, field, value, message) {
  if (value === undefined || value === null || value === '') {
    errors.push({ field, message });
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

  return errors;
}

function validateLaborData(laborData = {}, tenantId) {
  const errors = [];

  pushRequired(errors, 'laborData.companyId', laborData.companyId, 'La empresa es obligatoria.');
  pushRequired(errors, 'laborData.areaId', laborData.areaId, 'El área es obligatoria.');
  pushRequired(errors, 'laborData.positionId', laborData.positionId, 'El cargo es obligatorio.');
  pushRequired(errors, 'laborData.startDate', laborData.startDate, 'La fecha de inicio laboral es obligatoria.');

  if (laborData.companyId && !isUuid(laborData.companyId)) {
    errors.push({ field: 'laborData.companyId', message: 'La empresa debe ser un UUID válido.' });
  }

  ['branchId', 'areaId', 'positionId', 'workerTypeId', 'shiftId', 'supervisorId'].forEach((field) => {
    if (laborData[field] && !isUuid(laborData[field])) {
      errors.push({ field: `laborData.${field}`, message: 'Debe ser un UUID válido.' });
    }
  });

  if (laborData.startDate && !isValidDate(laborData.startDate)) {
    errors.push({ field: 'laborData.startDate', message: 'La fecha de inicio laboral no es válida.' });
  }

  if (laborData.requiresAttendance !== false && !laborData.shiftId) {
    errors.push({ field: 'laborData.shiftId', message: 'El turno es obligatorio para trabajadores con asistencia.' });
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

  if (contractData.costCenterId && !isUuid(contractData.costCenterId)) {
    errors.push({ field: 'contractData.costCenterId', message: 'El centro de costo debe ser un UUID válido.' });
  }

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

module.exports = {
  EMAIL_REGEX,
  UUID_REGEX,
  isUuid,
  validateOnboardingPayload
};
