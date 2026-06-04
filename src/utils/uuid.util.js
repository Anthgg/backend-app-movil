const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return UUID_REGEX.test(String(value || ''));
}

function buildInvalidUUIDResponse(field, errorCode, message) {
  return {
    success: false,
    message: message || `${field} invalido. Debe ser un UUID valido.`,
    code: errorCode,
    error_code: errorCode,
    errorCode,
    errors: [
      {
        field,
        message: message || `${field} invalido. Debe ser un UUID valido.`
      }
    ]
  };
}

function createInvalidUUIDError(field, errorCode, message) {
  const error = new Error(message || `${field} invalido. Debe ser un UUID valido.`);
  error.statusCode = 400;
  error.errorCode = errorCode;
  error.errors = [
    {
      field,
      message: error.message
    }
  ];
  return error;
}

function assertValidUUID(value, { field, errorCode, message }) {
  if (!isValidUUID(value)) {
    throw createInvalidUUIDError(field, errorCode, message);
  }
}

function assertValidWorkerId(workerId) {
  assertValidUUID(workerId, {
    field: 'workerId',
    errorCode: 'INVALID_WORKER_ID',
    message: 'workerId invalido. Debe ser un UUID valido.'
  });
}

function assertValidUserId(userId) {
  assertValidUUID(userId, {
    field: 'userId',
    errorCode: 'INVALID_USER_ID',
    message: 'userId invalido. Debe ser un UUID valido.'
  });
}

function assertValidContractId(contractId) {
  assertValidUUID(contractId, {
    field: 'contractId',
    errorCode: 'INVALID_CONTRACT_ID',
    message: 'contractId invalido. Debe ser un UUID valido.'
  });
}

function assertValidCrewId(crewId) {
  assertValidUUID(crewId, {
    field: 'crewId',
    errorCode: 'INVALID_CREW_ID',
    message: 'crewId invalido. Debe ser un UUID valido.'
  });
}

function validateUuidParam(paramName, options = {}) {
  const field = options.field || paramName;
  const errorCode = options.errorCode || `INVALID_${String(field).replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
  const message = options.message || `${field} invalido. Debe ser un UUID valido.`;

  return (req, res, next) => {
    const value = req.params[paramName];
    if (!isValidUUID(value)) {
      return res.status(400).json(buildInvalidUUIDResponse(field, errorCode, message));
    }
    return next();
  };
}

module.exports = {
  UUID_REGEX,
  isValidUUID,
  buildInvalidUUIDResponse,
  createInvalidUUIDError,
  assertValidUUID,
  assertValidWorkerId,
  assertValidUserId,
  assertValidContractId,
  assertValidCrewId,
  validateUuidParam
};
