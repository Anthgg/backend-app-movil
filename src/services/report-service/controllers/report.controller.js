const service = require('../services/report.service');
const excelExporter = require('../exporters/excel.exporter');
const pdfExporter = require('../exporters/pdf.exporter');
const { getCompanySettings } = require('../../company-settings-service/companySettings.service');
const { generateCorporatePdf } = require('../../pdf/pdf-generator.service');
const ReportExportService = require('../../reports/report-export.service');
const { logAudit } = require('../../../shared/utils/audit');
const moment = require('moment');

// Original JSON / Excel report controllers
exports.getAttendanceReport = async (req, res, next) => {
  try {
    const data = await service.getAttendanceData(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.exportAttendanceExcel = async (req, res, next) => {
  try {
    const data = await service.getAttendanceData(req.tenantId, req.query);
    const buffer = await excelExporter.generateAttendanceExcel(data, req.query);
    
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_EXCEL', entity: 'attendance_records', req });
    
    res.setHeader('Content-Disposition', 'attachment; filename=Reporte_Asistencia.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) { next(error); }
};

// Legacy GET endpoint updated to use corporate template
exports.exportAttendancePdf = async (req, res, next) => {
  try {
    const userFullName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : 'Sistema';
    const buffer = await ReportExportService.exportAttendancePdf({
      tenantId: req.tenantId,
      filters: req.query,
      user: { name: userFullName, email: req.user?.email }
    });
    
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: 'attendance_records', req });
    
    res.setHeader('Content-Disposition', 'attachment; filename=Reporte_Asistencia.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) { next(error); }
};

exports.getMonthlySummary = async (req, res, next) => {
  try {
    const data = await service.getMonthlySummaryData(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.exportMonthlySummaryExcel = async (req, res, next) => {
  try {
    const data = await service.getMonthlySummaryData(req.tenantId, req.query);
    const buffer = await excelExporter.generateMonthlySummaryExcel(data, req.query);
    
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_EXCEL', entity: 'monthly_summary', req });
    
    res.setHeader('Content-Disposition', 'attachment; filename=Resumen_Mensual.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) { next(error); }
};

// Legacy GET endpoint updated to use corporate template
exports.exportMonthlySummaryPdf = async (req, res, next) => {
  try {
    const userFullName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : 'Sistema';
    const buffer = await ReportExportService.exportMonthlySummaryPdf({
      tenantId: req.tenantId,
      filters: req.query,
      user: { name: userFullName, email: req.user?.email }
    });
    
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: 'monthly_summary', req });
    
    res.setHeader('Content-Disposition', 'attachment; filename=Resumen_Mensual.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) { next(error); }
};

// =========================================================================
// CORPORATE PDF ENDPOINTS (FABRYOR GLOBAL TEMPLATE SYSTEM)
// =========================================================================

// Helper function to process corporate PDF requests
async function handleCorporatePdfExport(req, res, next, { defaultTitle, exportMethodName, entityName }) {
  try {
    const userFullName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : 'Sistema';
    
    let buffer;
    
    const hasCustomData = req.body && (
      (req.body.columns && req.body.rows) ||
      (req.body.customData && req.body.customData.columns && req.body.customData.rows)
    );

    // Check if the client sent columns & rows directly or inside customData
    if (hasCustomData) {
      const custom = req.body.customData || {};
      const columns = req.body.columns || custom.columns;
      const rows = req.body.rows || custom.rows;
      const summary = req.body.summary || custom.summary;
      const reportTitle = req.body.reportTitle || custom.reportTitle;
      const documentType = req.body.documentType || custom.documentType;
      const filters = req.body.filters || custom.filters;
      const internalLabel = req.body.internalLabel || custom.internalLabel;
      const companyConfig = await getCompanySettings(req.tenantId);
      
      buffer = await generateCorporatePdf({
        companyConfig,
        reportTitle: reportTitle || defaultTitle,
        documentType: documentType || 'Documento interno',
        internalLabel: internalLabel || 'F-RRHH-01',
        filters: filters || {},
        columns: columns || [],
        rows: rows || [],
        summary: summary || null,
        generatedBy: userFullName,
        generatedAt: new Date()
      });
    } else {
      // Otherwise, fetch from the database using filters in req.body.filters
      const filters = req.body.filters || {};
      const custom = req.body.customData || {};
      const reportTitle = req.body.reportTitle || custom.reportTitle;
      const documentType = req.body.documentType || custom.documentType;
      const internalLabel = req.body.internalLabel || custom.internalLabel;

      buffer = await ReportExportService[exportMethodName]({
        tenantId: req.tenantId,
        filters,
        user: { name: userFullName, email: req.user?.email },
        customTitle: reportTitle,
        customDocType: documentType,
        customLabel: internalLabel
      });
    }

    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: entityName, req });

    const slug = defaultTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filename = `${slug}-${moment().format('YYYY-MM-DD')}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

exports.exportRequestsPdfCorporate = async (req, res, next) => {
  await handleCorporatePdfExport(req, res, next, {
    defaultTitle: 'REPORTE DE SOLICITUDES',
    exportMethodName: 'exportRequestsPdf',
    entityName: 'employee_requests'
  });
};

exports.exportAttendancePdfCorporate = async (req, res, next) => {
  await handleCorporatePdfExport(req, res, next, {
    defaultTitle: 'REPORTE CONSOLIDADO DE ASISTENCIA',
    exportMethodName: 'exportAttendancePdf',
    entityName: 'attendance_records'
  });
};

exports.exportWorkersPdfCorporate = async (req, res, next) => {
  await handleCorporatePdfExport(req, res, next, {
    defaultTitle: 'REPORTE DE COLABORADORES',
    exportMethodName: 'exportWorkersPdf',
    entityName: 'workers'
  });
};

exports.exportPayrollPdfCorporate = async (req, res, next) => {
  await handleCorporatePdfExport(req, res, next, {
    defaultTitle: 'REPORTE DE NÓMINA Y PLANILLA',
    exportMethodName: 'exportPayrollPdf',
    entityName: 'payroll_records'
  });
};

exports.exportMonthlySummaryPdfCorporate = async (req, res, next) => {
  await handleCorporatePdfExport(req, res, next, {
    defaultTitle: 'REPORTE DE RESUMEN MENSUAL',
    exportMethodName: 'exportMonthlySummaryPdf',
    entityName: 'monthly_summary'
  });
};

exports.exportVacationsPdfCorporate = async (req, res, next) => {
  await handleCorporatePdfExport(req, res, next, {
    defaultTitle: 'REPORTE DE VACACIONES',
    exportMethodName: 'exportVacationsPdf',
    entityName: 'vacations'
  });
};

exports.exportDocumentsPdfCorporate = async (req, res, next) => {
  await handleCorporatePdfExport(req, res, next, {
    defaultTitle: 'REPORTE DE DOCUMENTOS ADJUNTOS',
    exportMethodName: 'exportDocumentsPdf',
    entityName: 'documents'
  });
};
