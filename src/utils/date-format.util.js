const moment = require('moment');

/**
 * Formats a date into YYYY-MM-DD or standard display format.
 * 
 * @param {Date|string} date - The date to format
 * @param {string} formatPattern - Format pattern (default: 'DD/MM/YYYY')
 * @returns {string} - Formatted date string
 */
function formatDate(date, formatPattern = 'DD/MM/YYYY') {
  if (!date) return 'No configurado';
  const parsed = moment(date);
  return parsed.isValid() ? parsed.format(formatPattern) : String(date);
}

/**
 * Formats a timestamp into date and time.
 * 
 * @param {Date|string} date - The timestamp to format
 * @returns {string} - Formatted timestamp (DD/MM/YYYY HH:mm:ss)
 */
function formatDateTime(date) {
  return formatDate(date, 'DD/MM/YYYY HH:mm:ss');
}

/**
 * Normalizes filter values into a clean readable string.
 * 
 * @param {Object} filters - Key-value pair of filters
 * @returns {string} - Clean comma-separated filter list
 */
function formatFilters(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return 'Ninguno';
  }
  
  const statusTranslations = {
    'pending': 'Pendiente',
    'approved': 'Aprobado',
    'rejected': 'Rechazado',
    'observed': 'Observado',
    'cancelled': 'Cancelado',
    'draft': 'Borrador',
    'present': 'Presente',
    'absent': 'Faltó',
    'late': 'Tarde',
    'ACTIVE': 'Activo',
    'INACTIVE': 'Inactivo'
  };

  return Object.entries(filters)
    .filter(([_, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      // Translate keys/values if necessary
      const displayKey = key.replace(/_/g, ' ');
      const displayVal = statusTranslations[value] || value;
      return `${displayKey.charAt(0).toUpperCase() + displayKey.slice(1)}: ${displayVal}`;
    })
    .join(' | ') || 'Ninguno';
}

module.exports = {
  formatDate,
  formatDateTime,
  formatFilters
};
