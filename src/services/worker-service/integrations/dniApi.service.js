const axios = require('axios'); // We need to install axios
const logger = require('../../../shared/utils/logger');
require('dotenv').config();

class DniApiService {
  constructor() {
    this.provider = process.env.DNI_API_PROVIDER || 'apiperu';
    this.apiUrl = process.env.DNI_API_URL || 'https://api.apis.net.pe/v2/reniec/dni';
    this.apiToken = process.env.DNI_API_TOKEN;
  }

  validateDni(dni) {
    const dniRegex = /^[0-9]{8}$/;
    if (!dniRegex.test(dni)) {
      throw new Error('El DNI debe tener exactamente 8 dígitos numéricos.');
    }
  }

  async lookupDni(dni) {
    try {
      this.validateDni(dni);

      const headers = {};
      if (this.apiToken) {
        headers['Authorization'] = `Bearer ${this.apiToken}`;
      }

      // En apis.net.pe el parámetro suele ser ?numero=12345678 o en la ruta
      // Asumiremos el estandar de ?numero=
      const response = await axios.get(`${this.apiUrl}?numero=${dni}`, { headers, timeout: 5000 });
      
      return this.normalizeDniResponse(response.data, dni);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return null; // DNI no encontrado
      }
      logger.logError('DNI_API', 'Error consultando DNI externo', error, { dni });
      throw new Error('No se pudo consultar el DNI en este momento.');
    }
  }

  normalizeDniResponse(data, dni) {
    // Normalizar respuestas de distintas APIs (ej: apis.net.pe vs apiperu.dev)
    const normalized = {
      document_type: 'DNI',
      document_number: dni,
      first_name: data.nombres || data.first_name || '',
      last_name_paternal: data.apellidoPaterno || data.apellido_paterno || data.last_name_paternal || '',
      last_name_maternal: data.apellidoMaterno || data.apellido_materno || data.last_name_maternal || '',
      full_name: ''
    };

    normalized.full_name = data.nombreCompleto || `${normalized.first_name} ${normalized.last_name_paternal} ${normalized.last_name_maternal}`.trim();

    return normalized;
  }
}

module.exports = new DniApiService();
