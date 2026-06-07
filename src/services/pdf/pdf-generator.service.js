const { generateCorporatePdf } = require('../../templates/pdf/corporate-report.template');
const { getCompanySettings } = require('../company-settings-service/companySettings.service');
const logger = require('../../shared/utils/logger');

/**
 * Validates and triggers the corporate report PDF generation.
 * 
 * @param {Object} params
 * @param {Object|string} params.companyConfig - The company settings object or companyId UUID
 * @param {string} params.reportTitle - Title of the report
 * @param {string} [params.documentType="Documento interno"] - Document type category
 * @param {string} [params.internalLabel="F-RRHH-01"] - Internal format identifier
 * @param {Object} [params.filters={}] - Dictionary of filters applied
 * @param {Array} [params.infoSections=[]] - Adaptive report information sections
 * @param {Array} params.columns - Array of columns [{ key, label, widthRatio }]
 * @param {Array} params.rows - Array of rows
 * @param {Object} [params.summary=null] - Summary KPI cards
 * @param {boolean} [params.showSummaryCards=true] - Whether to draw summary cards
 * @param {string} [params.signatureMode="fixed"] - Signature layout mode
 * @param {string} [params.generatedBy=null] - User who generated the report
 * @param {Date|string} [params.generatedAt] - Generation time
 * @returns {Promise<Buffer>} - Resolves to the PDF buffer
 */
async function generateCorporateReportPdf({
  companyConfig,
  reportTitle,
  documentType = 'Documento interno',
  internalLabel = 'F-RRHH-01',
  filters = {},
  infoSections = [],
  columns = [],
  rows = [],
  summary = null,
  showSummaryCards = true,
  signatureMode = 'fixed',
  generatedBy = null,
  generatedAt = new Date()
}) {
  // 1. Validate inputs
  if (!reportTitle) {
    throw new Error('El título del reporte (reportTitle) es obligatorio.');
  }

  // 2. Load company configuration if UUID is provided
  let config = companyConfig;
  if (typeof companyConfig === 'string') {
    try {
      config = await getCompanySettings(companyConfig);
    } catch (err) {
      logger.logError('PDF', `Error loading company settings for ID "${companyConfig}"`, err);
    }
  }

  // Fallback if no config could be found or resolved
  if (!config) {
    logger.logWarn('PDF', 'No company config provided for corporate report PDF. Using default fallbacks.');
    config = {};
  }

  // 3. Columns & rows validations
  if (!Array.isArray(columns) || columns.length === 0) {
    logger.logWarn('PDF', 'PDF generation triggered with empty or invalid columns.');
  }

  if (!Array.isArray(rows)) {
    logger.logWarn('PDF', 'PDF generation triggered with invalid rows (not an array).');
    rows = [];
  }

  // 4. Generate the PDF buffer
  return await generateCorporatePdf({
    companyConfig: config,
    reportTitle,
    documentType,
    internalLabel,
    filters,
    infoSections,
    columns,
    rows,
    summary,
    showSummaryCards,
    signatureMode,
    generatedBy: generatedBy || 'Administrador',
    generatedAt
  });
}

module.exports = {
  generateCorporatePdf: generateCorporateReportPdf
};
