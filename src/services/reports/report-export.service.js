const reportService = require('../report-service/services/report.service');
const { generateCorporatePdf } = require('../pdf/pdf-generator.service');
const { formatDate, formatFilters } = require('../../utils/date-format.util');
const moment = require('moment');

class ReportExportService {
  
  async exportAttendancePdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getAttendanceData(tenantId, filters);

    const statusMap = { 
      'present': 'Presente', 
      'absent': 'Faltó', 
      'late': 'Tarde',
      'incomplete': 'Incompleto',
      'out_of_range': 'Fuera de Rango',
      'observed': 'Observado',
      'rejected': 'Rechazado',
      'corrected': 'Corregido',
      'justified_absence': 'Inasistencia Justificada',
      'vacation': 'Vacaciones',
      'medical_leave': 'Descanso Médico',
      'leave_permission': 'Permiso'
    };

    const formattedData = data.map(r => ({
      ...r,
      check_in_time: r.check_in_time ? moment(r.check_in_time).format('DD/MM/YYYY HH:mm:ss') : '-',
      check_out_time: r.check_out_time ? moment(r.check_out_time).format('DD/MM/YYYY HH:mm:ss') : '-',
      status: statusMap[r.status] || r.status
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.25 },
      { key: 'project_name', label: 'Proyecto/Sede', widthRatio: 0.20 },
      { key: 'check_in_time', label: 'H. Entrada', widthRatio: 0.22 },
      { key: 'check_out_time', label: 'H. Salida', widthRatio: 0.22 },
      { key: 'status', label: 'Estado', widthRatio: 0.11 }
    ];

    const summary = {
      'Total Registros': formattedData.length,
      'Asistencias': formattedData.filter(r => r.status === 'Presente').length,
      'Tardanzas': formattedData.filter(r => r.status === 'Tarde').length,
      'Inasistencias': formattedData.filter(r => r.status === 'Faltó').length
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE CONSOLIDADO DE ASISTENCIA',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-02',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportRequestsPdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getRequestsData(tenantId, filters);

    const statusMap = {
      'draft': 'Borrador',
      'pending': 'Pendiente',
      'pending_supervisor': 'Pendiente Supervisor',
      'pending_rrhh': 'Pendiente RRHH',
      'observed': 'Observado',
      'approved': 'Aprobado',
      'rejected': 'Rechazado',
      'cancelled': 'Cancelado'
    };

    const formattedData = data.map(r => ({
      ...r,
      start_date: r.start_date ? moment(r.start_date).format('DD/MM/YYYY') : '-',
      end_date: r.end_date ? moment(r.end_date).format('DD/MM/YYYY') : '-',
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

    const summary = {
      'Total Solicitudes': formattedData.length,
      'Aprobadas': formattedData.filter(r => r.status === 'Aprobado').length,
      'Pendientes': formattedData.filter(r => r.status.includes('Pendiente')).length,
      'Rechazadas': formattedData.filter(r => r.status === 'Rechazado').length
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE SOLICITUDES',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-03',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportWorkersPdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getWorkersData(tenantId, filters);

    const statusMap = {
      'ACTIVE': 'Activo',
      'INACTIVE': 'Inactivo'
    };

    const formattedData = data.map(r => ({
      ...r,
      hire_date: r.hire_date ? moment(r.hire_date).format('DD/MM/YYYY') : '-',
      status: statusMap[r.status] || r.status
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

    const summary = {
      'Total Colaboradores': formattedData.length,
      'Activos': formattedData.filter(r => r.status === 'Activo').length,
      'Inactivos': formattedData.filter(r => r.status === 'Inactivo').length
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE COLABORADORES',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-04',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportWorkCrewsPdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getWorkCrewsData(tenantId, filters);

    const formattedData = data.map(r => ({
      ...r,
      description: r.description || '-',
      supervisor_name: r.supervisor_name || '-',
      work_location_name: r.work_location_name || '-',
      active_workers_count: r.active_workers_count || 0
    }));

    const columns = [
      { key: 'name', label: 'Cuadrilla', widthRatio: 0.22 },
      { key: 'work_location_name', label: 'Obra Base', widthRatio: 0.22 },
      { key: 'supervisor_name', label: 'Supervisor', widthRatio: 0.20 },
      { key: 'active_workers_count', label: 'Trab.', widthRatio: 0.10 },
      { key: 'status', label: 'Estado', widthRatio: 0.10 },
      { key: 'description', label: 'Descripcion', widthRatio: 0.16 }
    ];

    const summary = {
      'Total Cuadrillas': formattedData.length,
      'Activas': formattedData.filter(r => r.status === 'Activa').length,
      'Trabajadores Activos': formattedData.reduce((acc, r) => acc + Number(r.active_workers_count || 0), 0)
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE EQUIPOS DE TRABAJO',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-09',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportWorkCrewMovementsPdf({ tenantId, body = {}, user = {}, customTitle, customDocType, customLabel }) {
    const result = await reportService.getWorkCrewMovementReportData(tenantId, body, { isExport: true });
    const rows = result.data.map((row) => {
      const mapped = {};
      result.columns.forEach((column) => {
        mapped[column.key] = row[column.key] ?? '-';
      });
      return mapped;
    });

    const summary = {
      'Total Registros': result.total,
      'Transferidos': result.rows.filter((row) => row.assignment_status === 'Transferido (Temporal)').length,
      'Obra Principal': result.rows.filter((row) => row.assignment_status === 'Obra Principal').length
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE CUADRILLAS Y MOVIMIENTOS',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-09',
      filters: body.filters || {},
      columns: result.columns,
      rows,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportMonthlySummaryPdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getMonthlySummaryData(tenantId, filters);

    const formattedData = data.map(r => ({
      ...r,
      total_days: r.total_days || 0,
      days_present: r.days_present || 0,
      days_absent: r.days_absent || 0,
      days_late: r.days_late || 0,
      total_worked_hours: r.total_worked_hours ? parseFloat(r.total_worked_hours).toFixed(1) : '0.0'
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.26 },
      { key: 'email', label: 'Correo Electrónico', widthRatio: 0.24 },
      { key: 'days_present', label: 'Días Pres.', widthRatio: 0.11 },
      { key: 'days_absent', label: 'Días Aus.', widthRatio: 0.11 },
      { key: 'days_late', label: 'Días Tard.', widthRatio: 0.11 },
      { key: 'total_worked_hours', label: 'H. Trab.', widthRatio: 0.17 }
    ];

    const totalDays = formattedData.reduce((acc, r) => acc + parseInt(r.total_days || 0), 0);
    const summary = {
      'Total Registros': formattedData.length,
      'Total Días Pres.': formattedData.reduce((acc, r) => acc + parseInt(r.days_present || 0), 0),
      'Total Tardanzas': formattedData.reduce((acc, r) => acc + parseInt(r.days_late || 0), 0),
      'Total Horas Trab.': formattedData.reduce((acc, r) => acc + parseFloat(r.total_worked_hours || 0), 0).toFixed(1)
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE RESUMEN MENSUAL',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-05',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportPayrollPdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getPayrollData(tenantId, filters);

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

    const totalNeto = data.reduce((acc, r) => acc + (parseFloat(r.net_salary) || 0), 0);
    const summary = {
      'Total Planillas': formattedData.length,
      'Total Neto a Pagar': `S/. ${totalNeto.toFixed(2)}`
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE NÓMINA Y PLANILLA',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-06',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportVacationsPdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getVacationsData(tenantId, filters);

    const statusMap = {
      'pending': 'Pendiente',
      'approved': 'Aprobado',
      'rejected': 'Rechazado'
    };

    const formattedData = data.map(r => ({
      ...r,
      start_date: r.start_date ? moment(r.start_date).format('DD/MM/YYYY') : '-',
      end_date: r.end_date ? moment(r.end_date).format('DD/MM/YYYY') : '-',
      status: statusMap[r.status] || r.status,
      approved_by_name: r.approved_by_name || '-'
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.25 },
      { key: 'email', label: 'Correo', widthRatio: 0.20 },
      { key: 'start_date', label: 'F. Inicio', widthRatio: 0.14 },
      { key: 'end_date', label: 'F. Fin', widthRatio: 0.14 },
      { key: 'total_days', label: 'Días', widthRatio: 0.08 },
      { key: 'status', label: 'Estado', widthRatio: 0.19 }
    ];

    const totalDays = formattedData.reduce((acc, r) => acc + parseFloat(r.total_days || 0), 0);
    const summary = {
      'Total Programaciones': formattedData.length,
      'Días Totales Programados': totalDays,
      'Aprobados': formattedData.filter(r => r.status === 'Aprobado').length
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE VACACIONES',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-07',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }

  async exportDocumentsPdf({ tenantId, filters = {}, user = {}, customTitle, customDocType, customLabel }) {
    const data = await reportService.getDocumentsData(tenantId, filters);

    const statusMap = {
      'PENDING': 'Pendiente',
      'APPROVED': 'Aprobado',
      'REJECTED': 'Rechazado'
    };

    const formattedData = data.map(r => ({
      ...r,
      uploaded_at: r.uploaded_at ? moment(r.uploaded_at).format('DD/MM/YYYY HH:mm') : '-',
      status: statusMap[r.status] || r.status
    }));

    const columns = [
      { key: 'full_name', label: 'Trabajador', widthRatio: 0.25 },
      { key: 'email', label: 'Correo', widthRatio: 0.22 },
      { key: 'document_type_name', label: 'Tipo Documento', widthRatio: 0.23 },
      { key: 'uploaded_at', label: 'F. Subida', widthRatio: 0.18 },
      { key: 'status', label: 'Estado', widthRatio: 0.12 }
    ];

    const summary = {
      'Total Documentos': formattedData.length,
      'Aprobados': formattedData.filter(r => r.status === 'Aprobado').length,
      'Pendientes': formattedData.filter(r => r.status === 'Pendiente').length
    };

    return await generateCorporatePdf({
      companyConfig: tenantId,
      reportTitle: customTitle || 'REPORTE DE DOCUMENTOS ADJUNTOS',
      documentType: customDocType || 'Documento interno',
      internalLabel: customLabel || 'F-RRHH-08',
      filters,
      columns,
      rows: formattedData,
      summary,
      generatedBy: user.name,
      generatedAt: new Date()
    });
  }
}

module.exports = new ReportExportService();
