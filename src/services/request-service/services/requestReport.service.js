const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const requestService = require('./request.service');

const AVAILABLE_COLUMNS = [
  { key: 'worker_name', label: 'Trabajador' },
  { key: 'type_name', label: 'Tipo de Solicitud' },
  { key: 'start_date', label: 'Fecha Inicio' },
  { key: 'end_date', label: 'Fecha Fin' },
  { key: 'days_requested', label: 'Días Solicitados' },
  { key: 'reason', label: 'Motivo' },
  { key: 'status', label: 'Estado' },
  { key: 'department_name', label: 'Departamento/Área' },
  { key: 'job_title', label: 'Puesto' },
  { key: 'created_at', label: 'Fecha Creación' },
  { key: 'hr_comment', label: 'Comentario Aprobador' }
];

class RequestReportService {
  getAvailableColumns() {
    return AVAILABLE_COLUMNS;
  }

  /**
   * Obtiene las columnas a exportar basadas en el query parameter 'columns' (separadas por coma)
   */
  #getSelectedColumns(columnsQuery) {
    if (!columnsQuery) {
      return AVAILABLE_COLUMNS;
    }
    const keys = columnsQuery.split(',').map(k => k.trim());
    const selected = AVAILABLE_COLUMNS.filter(col => keys.includes(col.key));
    return selected.length > 0 ? selected : AVAILABLE_COLUMNS;
  }

  async generateExcel(filters, tenantId) {
    // Obtener todas las solicitudes con un límite muy alto para reportes
    const queryFilters = { ...filters, limit: 100000, page: 1 };
    const result = await requestService.getRequests(queryFilters, tenantId);
    const data = result.data;

    const selectedCols = this.#getSelectedColumns(filters.columns);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte de Solicitudes');

    // Configurar columnas de exceljs
    worksheet.columns = selectedCols.map(col => ({
      header: col.label,
      key: col.key,
      width: col.key === 'reason' || col.key === 'hr_comment' ? 30 : 20
    }));

    // Mapear filas
    data.forEach(row => {
      const mappedRow = {};
      selectedCols.forEach(col => {
        let val = row[col.key];
        // Formatear fechas
        if (col.key === 'start_date' || col.key === 'end_date' || col.key === 'created_at') {
          if (val) {
            val = new Date(val).toISOString().slice(0, 10);
          }
        }
        // Traducir estados
        if (col.key === 'status') {
          const statusMap = {
            'pending': 'Pendiente',
            'approved': 'Aprobado',
            'rejected': 'Rechazado',
            'observed': 'Observado',
            'cancelled': 'Cancelado',
            'draft': 'Borrador'
          };
          val = statusMap[val] || val;
        }
        mappedRow[col.key] = val !== null && val !== undefined ? val : 'N/A';
      });
      worksheet.addRow(mappedRow);
    });

    // Dar estilo a la cabecera
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' } // Sleek Dark Blue
    };

    // Auto-ajustar alto de fila de cabecera
    worksheet.getRow(1).height = 24;

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  async generatePdf(filters, tenantId) {
    // Obtener solicitudes
    const queryFilters = { ...filters, limit: 100000, page: 1 };
    const result = await requestService.getRequests(queryFilters, tenantId);
    const data = result.data;

    const selectedCols = this.#getSelectedColumns(filters.columns);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 30, layout: 'landscape' }); // Landscape es mejor para tablas
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Título del reporte
        doc.fillColor('#1e3a8a').fontSize(22).text('Reporte Consolidado de Solicitudes', { align: 'center' });
        doc.fillColor('#4b5563').fontSize(10).text(`Generado el: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Tabla básica
        const startX = 30;
        let startY = 100;
        const pageHeight = doc.page.height;
        const pageWidth = doc.page.width;
        const availableWidth = pageWidth - 60;
        const colWidth = availableWidth / selectedCols.length;

        // Dibujar cabecera
        doc.fillColor('#1e3a8a').rect(startX, startY, availableWidth, 20).fill();
        doc.fillColor('#ffffff').fontSize(9);
        selectedCols.forEach((col, index) => {
          doc.text(col.label, startX + (index * colWidth) + 5, startY + 6, {
            width: colWidth - 10,
            ellipsis: true
          });
        });

        startY += 20;

        // Dibujar filas de datos
        doc.fillColor('#000000').fontSize(8);
        data.forEach((row, rowIndex) => {
          // Verificar si necesitamos cambiar de página
          if (startY > pageHeight - 50) {
            doc.addPage({ margin: 30, layout: 'landscape' });
            startY = 40;
            // Redibujar cabecera en nueva página
            doc.fillColor('#1e3a8a').rect(startX, startY, availableWidth, 20).fill();
            doc.fillColor('#ffffff').fontSize(9);
            selectedCols.forEach((col, index) => {
              doc.text(col.label, startX + (index * colWidth) + 5, startY + 6, {
                width: colWidth - 10,
                ellipsis: true
              });
            });
            startY += 20;
            doc.fillColor('#000000').fontSize(8);
          }

          // Cebra striping
          if (rowIndex % 2 === 0) {
            doc.fillColor('#f3f4f6').rect(startX, startY, availableWidth, 18).fill();
          }

          doc.fillColor('#374151');
          selectedCols.forEach((col, index) => {
            let val = row[col.key];
            if (col.key === 'start_date' || col.key === 'end_date' || col.key === 'created_at') {
              if (val) {
                val = new Date(val).toISOString().slice(0, 10);
              }
            }
            if (col.key === 'status') {
              const statusMap = {
                'pending': 'Pendiente',
                'approved': 'Aprobado',
                'rejected': 'Rechazado',
                'observed': 'Observado',
                'cancelled': 'Cancelado',
                'draft': 'Borrador'
              };
              val = statusMap[val] || val;
            }
            const cleanVal = val !== null && val !== undefined ? String(val) : 'N/A';

            doc.text(cleanVal, startX + (index * colWidth) + 5, startY + 5, {
              width: colWidth - 10,
              height: 12,
              ellipsis: true
            });
          });

          startY += 18;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = new RequestReportService();
