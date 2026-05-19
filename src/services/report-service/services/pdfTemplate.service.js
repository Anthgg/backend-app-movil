const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const { getCompanySettings } = require('../../company-settings-service/companySettings.service');

class PdfTemplateService {
  constructor() {
    this.companyName = process.env.COMPANY_NAME || 'FABRYOR SERVICIOS GENERALES S.A.C.';
    this.companyRuc = process.env.COMPANY_RUC || '20605153136';
    this.companyAddress = process.env.COMPANY_ADDRESS || 'San Juan de Miraflores MZA. D LOTE. 7 URB. VILLA SOLIDARIDAD (ESPALDA DE MCDO HEROES DEL PACIFICO)';
    this.companyEmail = process.env.COMPANY_EMAIL || 'eparvina@fabryor.com';
    this.companyPhone = process.env.COMPANY_PHONE || '[pendiente]';
    this.companyLogoPath = process.env.COMPANY_LOGO_PATH || path.join(__dirname, '../../../../public/assets/logo.png');
  }

  /**
   * Genera un búfer PDF con plantilla corporativa
   * @param {Object} options Parámetros del reporte
   * @param {string} options.title Título del reporte (ej: "Reporte de Asistencia")
   * @param {Array} options.filters Filtros aplicados para mostrar en la cabecera
   * @param {Object} options.user Usuario ejecutor { name: string, email: string }
   * @param {Array} options.columns Listado de columnas { key: string, label: string, widthRatio?: number }
   * @param {Array} options.data Datos del reporte (filas de objetos)
   * @param {Object} options.summary Datos estadísticos rápidos { key: val } (opcional)
   * @param {string} options.orientation Orientación del PDF ('portrait' | 'landscape')
   * @returns {Promise<Buffer>} Búfer binario del PDF generado
   */
  async generateCorporatePdf({
    title,
    filters = [],
    user = {},
    columns = [],
    data = [],
    summary = null,
    orientation = 'landscape',
    tenantId = null
  }) {
    return new Promise(async (resolve, reject) => {
      try {
        let company = {};
        if (tenantId) {
            company = await getCompanySettings(tenantId) || {};
        }

        const companyName = company.razon_social || process.env.COMPANY_NAME || 'FABRYOR SERVICIOS GENERALES S.A.C.';
        const companyRuc = company.ruc || process.env.COMPANY_RUC || '20605153136';
        const companyAddress = company.direccion_fiscal || process.env.COMPANY_ADDRESS || 'San Juan de Miraflores MZA. D LOTE. 7 URB. VILLA SOLIDARIDAD';
        const companyEmail = company.correo_corporativo || process.env.COMPANY_EMAIL || 'eparvina@fabryor.com';
        const companyPhone = company.telefono || process.env.COMPANY_PHONE || '[pendiente]';
        const companyLogoPath = company.logo_url || process.env.COMPANY_LOGO_PATH || path.join(__dirname, '../../../../public/assets/logo.png');

        const primaryColor = company.color_primario || '#1e3a8a';
        const secondaryColor = company.color_secundario || '#3b82f6';
        const textColor = company.color_texto || '#1f2937';
        const margin = 40;
        const doc = new PDFDocument({ margin, layout: orientation, bufferPages: true });
        const buffers = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Configuración de dimensiones
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const printableWidth = pageWidth - (margin * 2);

        const colors = {
          primary: primaryColor,
          secondary: secondaryColor,
          textDark: textColor,   
          textLight: '#4b5563',  
          bgLight: '#f3f4f6',    
          lineGray: '#d1d5db'    
        };

        // Función para dibujar el encabezado corporativo
        const drawCorporateHeader = (isFirstPage = true) => {
          const startY = margin;
          const logoSize = 55;

          // Intento de renderizar el logo corporativo o fallback en caso de no existir
          let logoExists = false;
          try {
            if (companyLogoPath.startsWith('http')) {
                // Not supported natively synchronous without fetching buffer, we fallback for now
                // Actually if it's http we might need to fetch it first, for simplicity we skip HTTP image here or use fallback
            } else if (fs.existsSync(companyLogoPath)) {
              doc.image(companyLogoPath, margin, startY, { width: logoSize, height: logoSize });
              logoExists = true;
            }
          } catch (e) {
            // Ignorar y usar fallback
          }

          if (!logoExists) {
            // Dibujar un logo corporativo geométrico elegante como fallback
            doc.save();
            doc.fillColor(colors.primary)
               .roundedRect(margin, startY, logoSize, logoSize, 8)
               .fill();
            doc.fillColor('#ffffff')
               .fontSize(22)
               .font('Helvetica-Bold')
               .text('F', margin + 18, startY + 14, { lineBreak: false });
            doc.restore();
          }

          // Información de la empresa
          const infoStartX = margin + logoSize + 15;
          doc.fillColor(colors.primary)
             .fontSize(13)
             .font('Helvetica-Bold')
             .text(companyName, infoStartX, startY, { width: printableWidth - logoSize - 15 });

          doc.fillColor(colors.textDark)
             .fontSize(8.5)
             .font('Helvetica-Bold')
             .text(`RUC: ${companyRuc}`, infoStartX, startY + 16)
             .font('Helvetica');

          const addressText = `Dirección: ${companyAddress}`;
          doc.text(addressText, infoStartX, startY + 28, { width: printableWidth - logoSize - 15 - 150 });

          // Email y teléfono en el lado derecho de la cabecera
          const rightInfoX = pageWidth - margin - 200;
          doc.text(`Correo: ${companyEmail}`, rightInfoX, startY + 16, { width: 200, align: 'right' });
          doc.text(`Teléfono: ${companyPhone}`, rightInfoX, startY + 28, { width: 200, align: 'right' });

          // Línea divisoria moderna doble
          const lineY = startY + 68;
          doc.strokeColor(colors.primary).lineWidth(1.5).moveTo(margin, lineY).lineTo(pageWidth - margin, lineY).stroke();
          doc.strokeColor(colors.secondary).lineWidth(0.5).moveTo(margin, lineY + 3).lineTo(pageWidth - margin, lineY + 3).stroke();

          return lineY + 10;
        };

        // RENDER DE PRIMERA PÁGINA
        let currentY = drawCorporateHeader(true);

        // Sección del Título del Reporte
        doc.moveDown(0.5);
        doc.fillColor(colors.primary)
           .fontSize(18)
           .font('Helvetica-Bold')
           .text(title, margin, currentY);
        
        currentY = doc.y;

        // Caja de Metadatos y Filtros
        doc.save();
        const metaBoxY = currentY + 8;
        const metaBoxHeight = 45;
        doc.fillColor(colors.bgLight)
           .roundedRect(margin, metaBoxY, printableWidth, metaBoxHeight, 4)
           .fill();
        
        // Rellenar datos
        doc.fillColor(colors.textDark).fontSize(8.5);
        const executorName = user.name || 'Sistema Automático';
        const executorEmail = user.email ? ` (${user.email})` : '';
        doc.font('Helvetica-Bold').text('Generado por: ', margin + 12, metaBoxY + 10, { continued: true })
           .font('Helvetica').text(`${executorName}${executorEmail}`, { continued: false });

        doc.font('Helvetica-Bold').text('Fecha de emisión: ', margin + 12, metaBoxY + 25, { continued: true })
           .font('Helvetica').text(moment().format('YYYY-MM-DD HH:mm:ss'));

        // Dibujar filtros en el lado derecho de la caja
        const filterText = filters.length > 0 
          ? filters.map(f => `${f.label}: ${f.value}`).join(' | ')
          : 'Ninguno (Todos)';
        
        doc.font('Helvetica-Bold').text('Filtros aplicados: ', margin + (printableWidth / 2), metaBoxY + 10, { continued: true })
           .font('Helvetica').text(filterText, { width: (printableWidth / 2) - 20, height: 28, ellipsis: true });
        
        doc.restore();

        currentY = metaBoxY + metaBoxHeight + 15;

        // Dibujar Resumen Estadístico (Opcional)
        if (summary && Object.keys(summary).length > 0) {
          const keys = Object.keys(summary);
          const cardWidth = (printableWidth - ((keys.length - 1) * 12)) / keys.length;
          const cardHeight = 40;

          keys.forEach((key, idx) => {
            const cardX = margin + (idx * (cardWidth + 12));
            doc.save();
            // Dibujar fondo de tarjeta
            doc.fillColor('#eff6ff') // Azul pálido
               .roundedRect(cardX, currentY, cardWidth, cardHeight, 4)
               .fill();
            
            // Dibujar borde izquierdo decorativo
            doc.fillColor(colors.primary)
               .rect(cardX, currentY, 4, cardHeight)
               .fill();

            // Rellenar etiquetas de la tarjeta
            doc.fillColor(colors.primary)
               .fontSize(14)
               .font('Helvetica-Bold')
               .text(String(summary[key]), cardX + 12, currentY + 6);

            doc.fillColor(colors.textLight)
               .fontSize(8)
               .font('Helvetica')
               .text(key, cardX + 12, currentY + 24, { width: cardWidth - 20, height: 12, ellipsis: true });

            doc.restore();
          });
          currentY += cardHeight + 18;
        }

        // TABLA DE DATOS
        // Calcular anchos de columnas proporcionalmente
        const definedWidths = columns.filter(c => c.widthRatio);
        const defaultWidth = (printableWidth - definedWidths.reduce((acc, c) => acc + (c.widthRatio * printableWidth), 0)) / (columns.length - definedWidths.length);
        
        const colWidths = columns.map(col => {
          return col.widthRatio ? col.widthRatio * printableWidth : defaultWidth;
        });

        // Función auxiliar para dibujar cabecera de la tabla
        const drawTableHeader = (y) => {
          doc.save();
          // Fondo azul
          doc.fillColor(colors.primary)
             .rect(margin, y, printableWidth, 20)
             .fill();

          doc.fillColor('#ffffff')
             .fontSize(8.5)
             .font('Helvetica-Bold');

          let runningX = margin;
          columns.forEach((col, idx) => {
            doc.text(col.label, runningX + 5, y + 6, {
              width: colWidths[idx] - 10,
              height: 12,
              ellipsis: true
            });
            runningX += colWidths[idx];
          });
          doc.restore();
          return y + 20;
        };

        // Dibujar cabecera inicial de la tabla
        let tableY = drawTableHeader(currentY);

        // Imprimir filas de datos
        doc.fontSize(8).font('Helvetica');
        
        data.forEach((row, rowIndex) => {
          const rowHeight = 18;

          // Detección de salto de página inteligente
          if (tableY + rowHeight > pageHeight - 60) {
            doc.addPage({ margin, layout: orientation });
            
            // Dibujar cabecera corporativa y de tabla en nueva página
            const headerEndY = drawCorporateHeader(false);
            tableY = drawTableHeader(headerEndY + 10);
            doc.fontSize(8).font('Helvetica');
          }

          // Cebra striping
          if (rowIndex % 2 === 0) {
            doc.save();
            doc.fillColor(colors.bgLight)
               .rect(margin, tableY, printableWidth, rowHeight)
               .fill();
            doc.restore();
          }

          // Bordes inferiores ligeros para celdas
          doc.save();
          doc.strokeColor(colors.lineGray)
             .lineWidth(0.5)
             .moveTo(margin, tableY + rowHeight)
             .lineTo(pageWidth - margin, tableY + rowHeight)
             .stroke();
          doc.restore();

          // Renderizar celdas
          let runningX = margin;
          doc.fillColor(colors.textDark);
          
          columns.forEach((col, idx) => {
            const rawVal = row[col.key];
            const cleanVal = rawVal !== null && rawVal !== undefined ? String(rawVal) : '-';

            doc.text(cleanVal, runningX + 5, tableY + 5, {
              width: colWidths[idx] - 10,
              height: 12,
              ellipsis: true
            });
            runningX += colWidths[idx];
          });

          tableY += rowHeight;
        });

        // PIE DE PÁGINA ESTÁNDAR (Dos Pasadas para números de página correctos)
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          
          const footerY = pageHeight - margin + 15;

          // Línea divisoria de pie de página
          doc.save();
          doc.strokeColor(colors.lineGray)
             .lineWidth(0.5)
             .moveTo(margin, footerY - 5)
             .lineTo(pageWidth - margin, footerY - 5)
             .stroke();

          // Textos
          doc.fillColor(colors.textLight)
             .fontSize(7.5)
             .font('Helvetica')
             .text(companyName, margin, footerY)
             .text('Documento generado automáticamente por el sistema', margin, footerY + 10)
             .text(`Página ${i + 1} de ${range.count}`, pageWidth - margin - 150, footerY, { width: 150, align: 'right' });
          doc.restore();
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = new PdfTemplateService();
