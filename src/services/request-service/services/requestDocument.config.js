function normalizeToken(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

const DEFAULT_REQUEST_DOCUMENT_CONFIG = Object.freeze({
  key: 'GENERAL_REQUEST',
  prefix: 'SOL',
  title: 'CONSTANCIA DE RECEPCION DE SOLICITUD LABORAL',
  typeLabel: 'Solicitud laboral',
  represents: 'Recepcion / revision',
  generationMoment: 'Al crear la solicitud',
  workerSignatureRequired: true,
  companySignatureRequired: false,
  supportRequired: false
});

const REQUEST_DOCUMENT_CONFIGS = Object.freeze({
  MEDICAL_LEAVE: Object.freeze({
    key: 'MEDICAL_LEAVE',
    prefix: 'DME',
    title: 'SOLICITUD DE REGISTRO DE DESCANSO MEDICO',
    typeLabel: 'Descanso medico',
    represents: 'Recepcion de solicitud para revision',
    generationMoment: 'Al crear la solicitud',
    workerSignatureRequired: true,
    companySignatureRequired: false,
    supportRequired: true
  }),
  VACATION: Object.freeze({
    key: 'VACATION',
    prefix: 'VAC',
    title: 'SOLICITUD DE DESCANSO VACACIONAL',
    typeLabel: 'Vacaciones',
    represents: 'Solicitud inicial o aprobacion, segun estado',
    generationMoment: 'Al crear la solicitud y al aprobarse',
    workerSignatureRequired: true,
    companySignatureRequired: true,
    supportRequired: false
  }),
  PERSONAL_PERMISSION: Object.freeze({
    key: 'PERSONAL_PERMISSION',
    prefix: 'PER',
    title: 'SOLICITUD DE PERMISO PERSONAL',
    typeLabel: 'Permiso personal',
    represents: 'Solicitud de autorizacion',
    generationMoment: 'Al crear la solicitud',
    workerSignatureRequired: true,
    companySignatureRequired: true,
    supportRequired: false
  }),
  ABSENCE_JUSTIFICATION: Object.freeze({
    key: 'ABSENCE_JUSTIFICATION',
    prefix: 'JIN',
    title: 'SOLICITUD DE JUSTIFICACION DE INASISTENCIA',
    typeLabel: 'Justificacion de inasistencia',
    represents: 'Solicitud de revision de asistencia',
    generationMoment: 'Al crear la solicitud',
    workerSignatureRequired: true,
    companySignatureRequired: true,
    supportRequired: true
  }),
  SHIFT_CHANGE: Object.freeze({
    key: 'SHIFT_CHANGE',
    prefix: 'CHO',
    title: 'SOLICITUD DE CAMBIO DE HORARIO O TURNO',
    typeLabel: 'Cambio de horario o turno',
    represents: 'Solicitud de modificacion',
    generationMoment: 'Al crear la solicitud',
    workerSignatureRequired: true,
    companySignatureRequired: true,
    supportRequired: false
  }),
  FAMILY_SERIOUS_ILLNESS_LEAVE: Object.freeze({
    key: 'FAMILY_SERIOUS_ILLNESS_LEAVE',
    prefix: 'LFG',
    title: 'SOLICITUD DE LICENCIA POR FAMILIAR DIRECTO CON ENFERMEDAD GRAVE',
    typeLabel: 'Licencia por familiar grave',
    represents: 'Solicitud de licencia',
    generationMoment: 'Al crear la solicitud',
    workerSignatureRequired: true,
    companySignatureRequired: true,
    supportRequired: true
  })
});

const REQUEST_TYPE_ALIASES = new Map([
  ['VACATION', 'VACATION'],
  ['VAC', 'VACATION'],
  ['VACACIONES', 'VACATION'],
  ['DESCANSO_VACACIONAL', 'VACATION'],

  ['MEDICAL_LEAVE', 'MEDICAL_LEAVE'],
  ['MEDICAL', 'MEDICAL_LEAVE'],
  ['DESCANSO_MEDICO', 'MEDICAL_LEAVE'],
  ['DESCANSO', 'MEDICAL_LEAVE'],
  ['DM', 'MEDICAL_LEAVE'],

  ['UNPAID_LEAVE', 'PERSONAL_PERMISSION'],
  ['PERSONAL_PERMISSION', 'PERSONAL_PERMISSION'],
  ['PERMISO_PERSONAL', 'PERSONAL_PERMISSION'],
  ['PERMISO', 'PERSONAL_PERMISSION'],
  ['LEAVE_PERMISSION', 'PERSONAL_PERMISSION'],

  ['ABSENCE_JUSTIFICATION', 'ABSENCE_JUSTIFICATION'],
  ['JUSTIFICACION_INASISTENCIA', 'ABSENCE_JUSTIFICATION'],
  ['JUSTIFICACION_DE_INASISTENCIA', 'ABSENCE_JUSTIFICATION'],
  ['INASISTENCIA', 'ABSENCE_JUSTIFICATION'],
  ['ABSENCE', 'ABSENCE_JUSTIFICATION'],

  ['SHIFT_CHANGE', 'SHIFT_CHANGE'],
  ['SCHEDULE_CHANGE', 'SHIFT_CHANGE'],
  ['CAMBIO_HORARIO', 'SHIFT_CHANGE'],
  ['CAMBIO_DE_HORARIO', 'SHIFT_CHANGE'],
  ['CAMBIO_TURNO', 'SHIFT_CHANGE'],
  ['CAMBIO_DE_TURNO', 'SHIFT_CHANGE'],

  ['FAMILY_SERIOUS_ILLNESS_LEAVE', 'FAMILY_SERIOUS_ILLNESS_LEAVE'],
  ['FAMILY_LEAVE', 'FAMILY_SERIOUS_ILLNESS_LEAVE'],
  ['LICENCIA_FAMILIAR_GRAVE', 'FAMILY_SERIOUS_ILLNESS_LEAVE'],
  ['LICENCIA_POR_FAMILIAR_GRAVE', 'FAMILY_SERIOUS_ILLNESS_LEAVE'],
  ['FAMILIAR_GRAVE', 'FAMILY_SERIOUS_ILLNESS_LEAVE']
]);

function resolveRequestDocumentConfig(typeCode, typeName) {
  for (const rawValue of [typeCode, typeName]) {
    const token = normalizeToken(rawValue);
    if (REQUEST_TYPE_ALIASES.has(token)) {
      return REQUEST_DOCUMENT_CONFIGS[REQUEST_TYPE_ALIASES.get(token)];
    }
  }

  return DEFAULT_REQUEST_DOCUMENT_CONFIG;
}

function buildRequestCode(sequence, typeCode, typeName) {
  const numericSequence = Number(sequence);
  const safeSequence = Number.isFinite(numericSequence) && numericSequence > 0
    ? Math.trunc(numericSequence)
    : 0;
  const config = resolveRequestDocumentConfig(typeCode, typeName);
  const padded = String(safeSequence).padStart(6, '0');

  return `F-RRHH-SOL-${config.prefix}-${padded}`;
}

module.exports = {
  DEFAULT_REQUEST_DOCUMENT_CONFIG,
  REQUEST_DOCUMENT_CONFIGS,
  normalizeToken,
  resolveRequestDocumentConfig,
  buildRequestCode
};
