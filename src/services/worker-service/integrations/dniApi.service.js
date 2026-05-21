const axios = require('axios');
const logger = require('../../../shared/utils/logger');
require('dotenv').config();

class DniApiService {
  constructor() {
    this.provider = process.env.DNI_API_PROVIDER || 'decolecta';
    this.apiUrl = process.env.DNI_API_URL || 'https://api.decolecta.com/v1/reniec/dni';
    this.apiToken = process.env.DNI_API_TOKEN;
  }

  validateDni(dni) {
    const dniRegex = /^[0-9]{8}$/;
    if (!dniRegex.test(dni)) {
      const error = new Error('El DNI debe tener exactamente 8 digitos numericos.');
      error.statusCode = 400;
      error.errorCode = 'DNI_INVALID';
      throw error;
    }
  }

  buildUpstreamError(response) {
    const upstreamStatus = response.status;
    const upstreamMessage = response.data?.message || response.data?.error || 'Error del proveedor DNI';
    const error = new Error(upstreamMessage);

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      error.statusCode = 424;
      error.errorCode = 'DNI_API_AUTH_FAILED';
    } else if (upstreamStatus === 429) {
      error.statusCode = 424;
      error.errorCode = 'DNI_API_QUOTA_EXCEEDED';
    } else if (upstreamStatus >= 500) {
      error.statusCode = 424;
      error.errorCode = 'DNI_API_UPSTREAM_ERROR';
    } else {
      error.statusCode = 424;
      error.errorCode = 'DNI_API_FAILED';
    }

    error.upstream = {
      provider: this.provider,
      status: upstreamStatus,
      message: upstreamMessage
    };

    return error;
  }

  async lookupDni(dni) {
    try {
      this.validateDni(dni);

      const headers = {};
      if (this.apiToken) {
        headers.Authorization = `Bearer ${this.apiToken}`;
      }
      headers['Content-Type'] = 'application/json';

      const response = await axios.get(`${this.apiUrl}?numero=${dni}`, {
        headers,
        timeout: 5000,
        validateStatus: () => true
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status !== 200) {
        throw this.buildUpstreamError(response);
      }

      return this.normalizeDniResponse(response.data, dni);
    } catch (error) {
      if (error.errorCode === 'DNI_INVALID') {
        throw error;
      }

      if (error.code === 'ECONNABORTED') {
        const timeoutError = new Error('El servicio externo de DNI agoto el tiempo de espera.');
        timeoutError.statusCode = 504;
        timeoutError.errorCode = 'DNI_API_TIMEOUT';
        timeoutError.upstream = {
          provider: this.provider,
          status: 504
        };
        logger.logError('DNI_API', 'Timeout consultando DNI externo', error, { dni, provider: this.provider });
        throw timeoutError;
      }

      if (error.response?.status === 404) {
        return null;
      }

      if (error.errorCode && error.upstream) {
        logger.logError('DNI_API', 'Error controlado consultando DNI externo', error, {
          dni,
          provider: this.provider,
          upstream_status: error.upstream.status
        });
        throw error;
      }

      logger.logError('DNI_API', 'Error consultando DNI externo', error, { dni, provider: this.provider });
      const unknownError = new Error('No se pudo consultar el DNI en este momento.');
      unknownError.statusCode = 424;
      unknownError.errorCode = 'DNI_API_FAILED';
      unknownError.upstream = {
        provider: this.provider,
        status: error.response?.status || null
      };
      throw unknownError;
    }
  }

  normalizeDniResponse(data, dni) {
    const normalized = {
      document_type: 'DNI',
      document_number: dni,
      first_name: data.nombres || data.first_name || '',
      last_name_paternal: data.apellidoPaterno || data.apellido_paterno || data.last_name_paternal || data.first_last_name || '',
      last_name_maternal: data.apellidoMaterno || data.apellido_materno || data.last_name_maternal || data.second_last_name || '',
      full_name: ''
    };

    normalized.full_name = data.nombreCompleto || `${normalized.first_name} ${normalized.last_name_paternal} ${normalized.last_name_maternal}`.trim();

    return normalized;
  }
}

module.exports = new DniApiService();
