const service = require('../services/report.service');
const excelExporter = require('../exporters/excel.exporter');
const pdfExporter = require('../exporters/pdf.exporter');
const pdfTemplateService = require('../services/pdfTemplate.service');
const { logAudit } = require('../../../shared/utils/audit');
const moment = require('moment');

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

// =========================================================================
// NUEVOS ENDPOINTS CORPORATIVOS DE REPORTES PDF (PLANTILLA CORPORATIVA FABRYOR)
// =========================================================================

exports.exportRequestsPdfCorporate = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const filters = payload.filters || {};
    
    const data = await service.getRequestsData(req.tenantId, filters);

    // Formatear fechas y traducir estados
    const statusMap = {
      'pending': 'Pendiente', 'approved': 'Aprobado', 'rejected': 'Rechazado',
      'observed': 'Observado', 'cancelled': 'Cancelado', 'draft': 'Borrador'
    };
    const formattedData = data.map(r => ({
      ...r,
      start_date: r.start_date ? moment(r.start_date).format('YYYY-MM-DD') : '-',
      end_date: r.end_date ? moment(r.end_date).format('YYYY-MM-DD') : '-',
      status: statusMap[r.status] || r.status
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.25 },
      { key: 'request_type', label: 'Tipo de Solicitud', widthRatio: 0.23 },
      { key: 'start_date', label: 'F. Inicio', widthRatio: 0.12 },
      { key: 'end_date', label: 'F. Fin', widthRatio: 0.12 },
      { key: 'days_requested', label: 'Días', widthRatio: 0.08 },
      { key: 'status', label: 'Estado', widthRatio: 0.20 }
    ];

    const filterList = [];
    if (filters.start_date) filterList.push({ label: 'Desde', value: filters.start_date });
    if (filters.end_date) filterList.push({ label: 'Hasta', value: filters.end_date });
    if (filters.status) filterList.push({ label: 'Estado', value: statusMap[filters.status] || filters.status });

    const summary = {
      'Total Solicitudes': formattedData.length,
      'Aprobadas': formattedData.filter(r => r.status === 'Aprobado').length,
      'Pendientes': formattedData.filter(r => r.status === 'Pendiente').length
    };

    const buffer = await pdfTemplateService.generateCorporatePdf({
      title: 'Reporte Consolidado de Solicitudes',
      filters: filterList,
      user: { name: req.user.name, email: req.user.email },
      columns,
      data: formattedData,
      summary,
      orientation: 'landscape',
      tenantId: req.tenantId
    });

    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: 'employee_requests', req });

    const filename = `reporte-solicitudes-${moment().format('YYYY-MM-DD')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) { next(error); }
};

exports.exportAttendancePdfCorporate = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const filters = payload.filters || {};
    
    const data = await service.getAttendanceData(req.tenantId, filters);

    // Formatear datos
    const statusMap = { 'present': 'Presente', 'absent': 'Faltó', 'late': 'Tarde' };
    const formattedData = data.map(r => ({
      ...r,
      check_in_time: r.check_in_time ? moment(r.check_in_time).format('YYYY-MM-DD HH:mm:ss') : '-',
      check_out_time: r.check_out_time ? moment(r.check_out_time).format('YYYY-MM-DD HH:mm:ss') : '-',
      status: statusMap[r.status] || r.status
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.25 },
      { key: 'project_name', label: 'Proyecto/Sede', widthRatio: 0.20 },
      { key: 'check_in_time', label: 'H. Entrada', widthRatio: 0.22 },
      { key: 'check_out_time', label: 'H. Salida', widthRatio: 0.22 },
      { key: 'status', label: 'Estado', widthRatio: 0.11 }
    ];

    const filterList = [];
    if (filters.start_date) filterList.push({ label: 'Desde', value: filters.start_date });
    if (filters.end_date) filterList.push({ label: 'Hasta', value: filters.end_date });

    const summary = {
      'Total Registros': formattedData.length,
      'Asistencias': formattedData.filter(r => r.status === 'Presente').length,
      'Tardanzas': formattedData.filter(r => r.status === 'Tarde').length
    };

    const buffer = await pdfTemplateService.generateCorporatePdf({
      title: 'Reporte Consolidado de Asistencias',
      filters: filterList,
      user: { name: req.user.name, email: req.user.email },
      columns,
      data: formattedData,
      summary,
      orientation: 'landscape',
      tenantId: req.tenantId
    });

    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: 'attendance_records', req });

    const filename = `reporte-asistencia-${moment().format('YYYY-MM-DD')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) { next(error); }
};

exports.exportWorkersPdfCorporate = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const filters = payload.filters || {};
    
    const data = await service.getWorkersData(req.tenantId, filters);

    const formattedData = data.map(r => ({
      ...r,
      hire_date: r.hire_date ? moment(r.hire_date).format('YYYY-MM-DD') : '-',
      status: r.status === 'ACTIVE' ? 'Activo' : r.status === 'INACTIVE' ? 'Inactivo' : r.status
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.22 },
      { key: 'email', label: 'Correo Electrónico', widthRatio: 0.22 },
      { key: 'document_number', label: 'N° Documento', widthRatio: 0.12 },
      { key: 'phone_number', label: 'Teléfono', widthRatio: 0.12 },
      { key: 'department_name', label: 'Área', widthRatio: 0.12 },
      { key: 'job_title', label: 'Puesto', widthRatio: 0.12 },
      { key: 'status', label: 'Estado', widthRatio: 0.08 }
    ];

    const filterList = [];
    if (filters.status) filterList.push({ label: 'Estado', value: filters.status });

    const summary = {
      'Total Trabajadores': formattedData.length,
      'Activos': formattedData.filter(r => r.status === 'Activo').length,
      'Inactivos': formattedData.filter(r => r.status === 'Inactivo').length
    };

    const buffer = await pdfTemplateService.generateCorporatePdf({
      title: 'Reporte Consolidado de Colaboradores',
      filters: filterList,
      user: { name: req.user.name, email: req.user.email },
      columns,
      data: formattedData,
      summary,
      orientation: 'landscape',
      tenantId: req.tenantId
    });

    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: 'workers', req });

    const filename = `reporte-trabajadores-${moment().format('YYYY-MM-DD')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) { next(error); }
};

exports.exportPayrollPdfCorporate = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const filters = payload.filters || {};
    
    const data = await service.getPayrollData(req.tenantId, filters);

    const formattedData = data.map(r => ({
      ...r,
      basic_salary: r.basic_salary ? `S/. ${parseFloat(r.basic_salary).toFixed(2)}` : 'S/. 0.00',
      gross_salary: r.gross_salary ? `S/. ${parseFloat(r.gross_salary).toFixed(2)}` : 'S/. 0.00',
      deductions_total: r.deductions_total ? `S/. ${parseFloat(r.deductions_total).toFixed(2)}` : 'S/. 0.00',
      net_salary: r.net_salary ? `S/. ${parseFloat(r.net_salary).toFixed(2)}` : 'S/. 0.00'
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.22 },
      { key: 'period_name', label: 'Periodo Planilla', widthRatio: 0.18 },
      { key: 'basic_salary', label: 'Sueldo Básico', widthRatio: 0.15 },
      { key: 'gross_salary', label: 'Sueldo Bruto', widthRatio: 0.15 },
      { key: 'deductions_total', label: 'Deducciones', widthRatio: 0.15 },
      { key: 'net_salary', label: 'Sueldo Neto', widthRatio: 0.15 }
    ];

    const filterList = [];
    if (filters.status) filterList.push({ label: 'Estado', value: filters.status });

    const totalNeto = data.reduce((acc, r) => acc + (parseFloat(r.net_salary) || 0), 0);
    const summary = {
      'Total Planillas': formattedData.length,
      'Total Neto a Pagar': `S/. ${totalNeto.toFixed(2)}`
    };

    const buffer = await pdfTemplateService.generateCorporatePdf({
      title: 'Reporte Consolidado de Planilla (Nómina)',
      filters: filterList,
      user: { name: req.user.name, email: req.user.email },
      columns,
      data: formattedData,
      summary,
      orientation: 'landscape',
      tenantId: req.tenantId
    });

    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'REPORTS', action: 'EXPORT_PDF', entity: 'payroll_records', req });

    const filename = `reporte-planilla-${moment().format('YYYY-MM-DD')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (error) { next(error); }
};
