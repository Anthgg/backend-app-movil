const PDFDocument = require('pdfkit');

exports.generateAttendancePdf = (data, filters) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30 });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(20).text('Reporte de Asistencia', { align: 'center' });
      doc.moveDown();

      data.forEach(row => {
        doc.fontSize(10).text(`${row.email} | Estado: ${row.status} | Tardanza: ${row.late_minutes || 0} min | H. Trabajadas: ${row.worked_hours || 0}`);
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

exports.generateMonthlySummaryPdf = (data, filters) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30 });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(20).text('Resumen Mensual', { align: 'center' });
      doc.moveDown();

      data.forEach(row => {
        doc.fontSize(10).text(`${row.email} | Días Asistidos: ${row.days_present} | Faltas: ${row.days_absent} | Tardanzas: ${row.days_late} | H. Trab: ${row.total_worked_hours || 0}`);
        doc.moveDown(0.5);
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};
