const ExcelJS = require('exceljs');

exports.generateAttendanceExcel = async (data, filters) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Asistencias');

  worksheet.columns = [
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Proyecto', key: 'project_name', width: 20 },
    { header: 'Entrada', key: 'check_in_time', width: 20 },
    { header: 'Salida', key: 'check_out_time', width: 20 },
    { header: 'Estado', key: 'status', width: 15 },
    { header: 'Tardanza (min)', key: 'late_minutes', width: 15 },
    { header: 'Horas Trab.', key: 'worked_hours', width: 15 }
  ];

  data.forEach(row => worksheet.addRow(row));

  // Estilo cabecera
  worksheet.getRow(1).font = { bold: true };
  
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

exports.generateMonthlySummaryExcel = async (data, filters) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Resumen Mensual');

  worksheet.columns = [
    { header: 'Trabajador Email', key: 'email', width: 25 },
    { header: 'Días Asistidos', key: 'days_present', width: 15 },
    { header: 'Faltas', key: 'days_absent', width: 10 },
    { header: 'Tardanzas', key: 'days_late', width: 10 },
    { header: 'Minutos Tarde Total', key: 'total_late_minutes', width: 20 },
    { header: 'Horas Trabajadas', key: 'total_worked_hours', width: 20 }
  ];

  data.forEach(row => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
  
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

exports.generateWorkCrewsExcel = async (data, filters = {}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FABRYOR RRHH';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Equipos de Trabajo');

  worksheet.columns = [
    { header: 'Cuadrilla', key: 'name', width: 28 },
    { header: 'Obra Base', key: 'work_location_name', width: 28 },
    { header: 'Supervisor', key: 'supervisor_name', width: 26 },
    { header: 'Correo Supervisor', key: 'supervisor_email', width: 30 },
    { header: 'Trabajadores Activos', key: 'active_workers_count', width: 20 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'Descripcion', key: 'description', width: 36 }
  ];

  data.forEach(row => worksheet.addRow({
    ...row,
    description: row.description || '-',
    active_workers_count: Number(row.active_workers_count || 0)
  }));

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  header.alignment = { vertical: 'middle' };

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length }
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

exports.generateDynamicWorkCrewsExcel = async ({ rows, columns }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FABRYOR RRHH';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Cuadrillas y Movimientos');
  worksheet.columns = columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: ['worker_name', 'worker_email', 'current_location_name', 'reason'].includes(column.key) ? 30 : 20
  }));

  rows.forEach((row) => worksheet.addRow(row));

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  header.height = 24;
  header.alignment = { vertical: 'middle' };

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length }
  };

  return workbook.xlsx.writeBuffer();
};
