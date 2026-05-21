const dniApi = require('../worker-service/integrations/dniApi.service');
const { query } = require('../../config/database');

function validateDni(dni) {
  if (!dni || !/^\d{8}$/.test(String(dni))) {
    const error = new Error('El DNI debe tener exactamente 8 dígitos numéricos.');
    error.statusCode = 400;
    error.errorCode = 'DNI_INVALID';
    error.errors = [{ field: 'dni', message: 'El DNI debe tener 8 dígitos y solo números.' }];
    throw error;
  }
}

function normalizeDniData(data, dni) {
  if (!data) {
    return null;
  }

  const firstName = data.first_name || data.nombres || '';
  const paternalLastName = data.paternal_last_name || data.last_name_paternal || data.apellidoPaterno || '';
  const maternalLastName = data.maternal_last_name || data.last_name_maternal || data.apellidoMaterno || '';
  const fullName = data.full_name || [firstName, paternalLastName, maternalLastName].filter(Boolean).join(' ');

  return {
    dni,
    first_name: firstName,
    paternal_last_name: paternalLastName,
    maternal_last_name: maternalLastName,
    full_name: fullName
  };
}

async function lookupDni(dni, requestedBy, req = {}) {
  validateDni(dni);

  try {
    const data = await dniApi.lookupDni(dni);
    const normalized = normalizeDniData(data, dni);

    await query(
      `INSERT INTO dni_lookup_logs (dni, requested_by, provider, success, response_status, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        dni,
        requestedBy,
        dniApi.provider,
        !!normalized,
        normalized ? '200' : '404',
        req.ip || req.headers?.['x-forwarded-for'] || null,
        req.headers?.['user-agent'] || null
      ]
    );

    return normalized;
  } catch (error) {
    if (error.errorCode === 'DNI_INVALID') {
      throw error;
    }

    await query(
      `INSERT INTO dni_lookup_logs (dni, requested_by, provider, success, error_message, ip_address, user_agent)
       VALUES ($1, $2, $3, false, $4, $5, $6)`,
      [
        dni,
        requestedBy,
        dniApi.provider,
        error.message,
        req.ip || req.headers?.['x-forwarded-for'] || null,
        req.headers?.['user-agent'] || null
      ]
    ).catch(() => null);

    const wrapped = new Error('No se pudo consultar el DNI en este momento.');
    wrapped.statusCode = 502;
    wrapped.errorCode = 'DNI_API_FAILED';
    throw wrapped;
  }
}

module.exports = {
  validateDni,
  lookupDni
};
