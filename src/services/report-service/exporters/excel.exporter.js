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
