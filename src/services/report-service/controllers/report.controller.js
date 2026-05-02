const service = require('../services/report.service');
const excelExporter = require('../exporters/excel.exporter');
const pdfExporter = require('../exporters/pdf.exporter');
const { logAudit } = require('../../../shared/utils/audit');

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

exports.exportAttendancePdf = async (req, res, next) => {
  try {
    const data = await service.getAttendanceData(req.tenantId, req.query);
    const buffer = await pdfExporter.generateAttendancePdf(data, req.query);
    
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

exports.exportMonthlySummaryPdf = async (req, res, next) => {
  try {
    const data = await service.getMonthlySummaryData(req.tenantId, req.query);
    const buffer = await pdfExporter.generateMonthlySummaryPdf(data, req.query);
    
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: 'monthly_summary', req });
    
    res.setHeader('Content-Disposition', 'attachment; filename=Resumen_Mensual.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) { next(error); }
};
