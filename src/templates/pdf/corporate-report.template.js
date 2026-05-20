const PDFDocument = require('pdfkit');
const { loadAsset } = require('../../utils/pdf-assets.util');
const { formatDateTime, formatDate, formatFilters } = require('../../utils/date-format.util');
const logger = require('../../shared/utils/logger');

/**
 * Generates the official corporate report PDF buffer.
 * 
 * @param {Object} payload
 * @param {Object} payload.companyConfig - Corporate configuration details
 * @param {string} payload.reportTitle - Title of the report
 * @param {string} [payload.documentType] - e.g., 'Documento interno'
 * @param {string} [payload.internalLabel] - Label or code (e.g., 'F-RRHH-02')
 * @param {Object|Array} [payload.filters] - Filters applied to the report
 * @param {Array} payload.columns - Columns definition [{ key, label, widthRatio }]
 * @param {Array} payload.rows - Rows data
 * @param {Object} [payload.summary] - Stat cards for report summary
 * @param {string} [payload.generatedBy] - Name of the user generating the report
 * @param {Date|string} [payload.generatedAt] - Generation timestamp
 * @returns {Promise<Buffer>} - Resolves to the PDF buffer
 */
async function generateCorporatePdf({
  companyConfig = {},
  reportTitle,
  documentType = 'Documento interno',
  internalLabel = 'F-RRHH-01',
  filters = {},
  columns = [],
  rows = [],
  summary = null,
  generatedBy = 'Sistema',
  generatedAt = new Date()
}) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Resolve and load company assets (logo, signature, stamp)
      // Normalize camelCase and snake_case properties
      const legalName = companyConfig.legalName || companyConfig.razon_social || 'FABRYOR SERVICIOS GENERALES S.A.C.';
      const commercialName = companyConfig.commercialName || companyConfig.nombre_comercial || 'FABRYOR';
      const ruc = companyConfig.ruc || '20605153136';
      const fiscalAddress = companyConfig.fiscalAddress || companyConfig.direccion_fiscal || 'S.J.M., Lima, Perú';
      const email = companyConfig.email || companyConfig.correo_corporativo || 'eparvina@fabryor.com';
      const phone = companyConfig.phone || companyConfig.telefono || 'No configurado';
      const website = companyConfig.website || companyConfig.pagina_web || 'www.fabryor.com';
      
      const logoUrl = companyConfig.logoUrl || companyConfig.logo_url;
      const signatureUrl = companyConfig.signatureUrl || companyConfig.firma_url;
      const stampUrl = companyConfig.stampUrl || companyConfig.sello_url;
      
      const legalRepresentativeName = companyConfig.legalRepresentativeName || companyConfig.representante_legal || 'LUCIANO PARVINA EDGAR VICENTE';
      const legalRepresentativeRole = companyConfig.legalRepresentativeRole || companyConfig.cargo_representante || 'Representante Legal';

      // Design style variables
      const primaryColor = companyConfig.colorPrimario || companyConfig.color_primario || '#1e3a8a';
      const secondaryColor = companyConfig.colorSecundario || companyConfig.color_secundario || '#3b82f6';
      const textColor = companyConfig.colorTexto || companyConfig.color_texto || '#0f172a';
      
      const colors = {
        primary: primaryColor,
        secondary: secondaryColor,
        textDark: textColor,
        textLight: '#475569',
        bgLight: '#f8fafc',
        borderLight: '#cbd5e1',
        white: '#ffffff'
      };

      // Load buffers asynchronously
      const [logoBuffer, signatureBuffer, stampBuffer] = await Promise.all([
        loadAsset(logoUrl),
        loadAsset(signatureUrl),
        loadAsset(stampUrl)
      ]);

      const margin = 40;
      // Setup PDFKit document: A4 vertical, portrait
      const doc = new PDFDocument({ 
        size: 'A4', 
        layout: 'portrait', 
        margin,
        bufferPages: true 
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const printableWidth = pageWidth - (margin * 2);

      // Helper function to draw corporate header
      const drawCorporateHeader = (y) => {
        const logoSize = 45;
        doc.save();

        // 1. Draw logo or placeholder
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, margin, y, { width: logoSize, height: logoSize });
          } catch (err) {
            logger.error(`Error rendering logo in PDF: ${err.message}`);
            drawLogoPlaceholder(y, logoSize);
          }
        } else {
          drawLogoPlaceholder(y, logoSize);
        }

        // 2. Draw company details (Left text)
        const leftX = margin + logoSize + 12;
        doc.fillColor(colors.primary)
           .font('Helvetica-Bold')
           .fontSize(11)
           .text(legalName, leftX, y, { width: 230 });

        doc.fillColor(colors.textDark)
           .font('Helvetica-Bold')
           .fontSize(7.5)
           .text(`RUC: ${ruc}`, leftX, y + 15);

        doc.font('Helvetica')
           .fillColor(colors.textLight)
           .fontSize(7)
           .text(`Dirección: ${fiscalAddress}`, leftX, y + 25, { width: 230 });

        // 3. Draw contact details (Right text)
        const rightX = pageWidth - margin - 180;
        doc.font('Helvetica')
           .fontSize(7)
           .fillColor(colors.textLight)
           .text(`Email: ${email}`, rightX, y, { width: 180, align: 'right' })
           .text(`Telf: ${phone}`, rightX, y + 10, { width: 180, align: 'right' })
           .text(`Web: ${website}`, rightX, y + 20, { width: 180, align: 'right' });

        // 4. Header double divider line
        const lineY = y + logoSize + 8;
        doc.strokeColor(colors.primary)
           .lineWidth(1.2)
           .moveTo(margin, lineY)
           .lineTo(pageWidth - margin, lineY)
           .stroke();

        doc.strokeColor(colors.secondary)
           .lineWidth(0.5)
           .moveTo(margin, lineY + 2.5)
           .lineTo(pageWidth - margin, lineY + 2.5)
           .stroke();

        doc.restore();
        return lineY + 8;
      };

      // Draw logo fallback geometry
      const drawLogoPlaceholder = (y, size) => {
        doc.save();
        doc.fillColor(colors.primary)
           .roundedRect(margin, y, size, size, 6)
           .fill();
        doc.fillColor('#ffffff')
           .font('Helvetica-Bold')
           .fontSize(18)
           .text(commercialName.charAt(0).toUpperCase(), margin + 16, y + 13, { lineBreak: false });
        doc.restore();
      };

      // Draw initial header
      let currentY = drawCorporateHeader(margin);

      // 2. Document Information (Metadata Box)
      doc.moveDown(0.5);
      
      // Report Title
      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(14)
         .text(reportTitle.toUpperCase(), margin, doc.y);

      const metadataY = doc.y + 6;
      const metadataHeight = 44;

      // Box design
      doc.save();
      doc.fillColor(colors.bgLight)
         .roundedRect(margin, metadataY, printableWidth, metadataHeight, 4)
         .fill();
      doc.strokeColor(colors.borderLight)
         .lineWidth(0.5)
         .roundedRect(margin, metadataY, printableWidth, metadataHeight, 4)
         .stroke();
      doc.restore();

      // Info Texts inside Metadata Box
      doc.save();
      doc.fontSize(8).fillColor(colors.textDark);
      
      const colWidth = (printableWidth - 24) / 2;
      
      // Left Column
      doc.font('Helvetica-Bold')
         .text('Tipo de Documento: ', margin + 12, metadataY + 8, { continued: true })
         .font('Helvetica').text(documentType);
      
      doc.font('Helvetica-Bold')
         .text('Generado por: ', margin + 12, metadataY + 20, { continued: true })
         .font('Helvetica').text(generatedBy || 'Sistema');

      doc.font('Helvetica-Bold')
         .text('Código interno: ', margin + 12, metadataY + 32, { continued: true })
         .font('Helvetica').text(internalLabel || 'F-RRHH-01');

      // Right Column
      const rColX = margin + 12 + colWidth;
      doc.font('Helvetica-Bold')
         .text('Fecha generación: ', rColX, metadataY + 8, { continued: true })
         .font('Helvetica').text(formatDateTime(generatedAt));

      // Handle filters display
      const filtersDisplay = typeof filters === 'object' ? formatFilters(filters) : String(filters || 'Ninguno');
      doc.font('Helvetica-Bold')
         .text('Filtros aplicados: ', rColX, metadataY + 20, { continued: true })
         .font('Helvetica').text(filtersDisplay, { width: colWidth - 10, height: 20, ellipsis: true });

      doc.restore();

      currentY = metadataY + metadataHeight + 15;

      // 3. Dynamic Data Table
      if (columns.length > 0) {
        // Calculate columns actual widths based on ratio or equal sharing
        const definedRatios = columns.filter(c => c.widthRatio);
        const sumDefined = definedRatios.reduce((acc, c) => acc + c.widthRatio, 0);
        const remainingWidth = 1 - sumDefined;
        const equalRatio = remainingWidth / (columns.length - definedRatios.length);

        const colWidths = columns.map(c => {
          const ratio = c.widthRatio !== undefined ? c.widthRatio : equalRatio;
          return ratio * printableWidth;
        });

        // Table Header drawing function
        const drawTableHeader = (y) => {
          doc.save();
          // Header Background
          doc.fillColor(colors.primary)
             .rect(margin, y, printableWidth, 18)
             .fill();

          doc.fillColor(colors.white)
             .font('Helvetica-Bold')
             .fontSize(7.5);

          let runningX = margin;
          columns.forEach((col, idx) => {
            doc.text(col.label, runningX + 4, y + 5, {
              width: colWidths[idx] - 8,
              height: 10,
              ellipsis: true,
              align: 'left'
            });
            runningX += colWidths[idx];
          });
          doc.restore();
          return y + 18;
        };

        // Draw initial table header
        let tableY = drawTableHeader(currentY);

        doc.fontSize(7).font('Helvetica');

        // Draw Rows
        rows.forEach((row, rowIndex) => {
          // Calculate height of the row based on text wrapping
          let rowHeight = 15; // default minimum
          
          columns.forEach((col, idx) => {
            const rawVal = row[col.key];
            const textVal = rawVal !== null && rawVal !== undefined ? String(rawVal) : '-';
            const cellHeight = doc.heightOfString(textVal, { width: colWidths[idx] - 8 }) + 6; // padding
            if (cellHeight > rowHeight) {
              rowHeight = cellHeight;
            }
          });

          // Page break check (standard page limit: height - margin - pageNumFooterHeight)
          const pageLimit = pageHeight - margin - 40;
          if (tableY + rowHeight > pageLimit) {
            doc.addPage();
            const headerEndY = drawCorporateHeader(margin);
            tableY = drawTableHeader(headerEndY + 10);
            doc.fontSize(7).font('Helvetica');
          }

          // Zebra background striping
          if (rowIndex % 2 === 0) {
            doc.save();
            doc.fillColor(colors.bgLight)
               .rect(margin, tableY, printableWidth, rowHeight)
               .fill();
            doc.restore();
          }

          // Cell bottom border line
          doc.save();
          doc.strokeColor(colors.borderLight)
             .lineWidth(0.3)
             .moveTo(margin, tableY + rowHeight)
             .lineTo(pageWidth - margin, tableY + rowHeight)
             .stroke();
          doc.restore();

          // Render cell text
          let cellX = margin;
          doc.fillColor(colors.textDark);
          columns.forEach((col, idx) => {
            const rawVal = row[col.key];
            const textVal = rawVal !== null && rawVal !== undefined ? String(rawVal) : '-';

            doc.text(textVal, cellX + 4, tableY + 3, {
              width: colWidths[idx] - 8,
              height: rowHeight - 6,
              align: 'left',
              lineBreak: true
            });
            cellX += colWidths[idx];
          });

          tableY += rowHeight;
        });

        currentY = tableY + 15;
      }

      // 4. Summary / Resumen block
      if (summary && Object.keys(summary).length > 0) {
        const keys = Object.keys(summary);
        
        // Height needed for summary cards
        const summaryHeight = 40;
        if (currentY + summaryHeight > pageHeight - margin - 40) {
          doc.addPage();
          const headerEndY = drawCorporateHeader(margin);
          currentY = headerEndY + 15;
        }

        doc.save();
        const cardSpacing = 10;
        const totalCardsWidth = printableWidth - ((keys.length - 1) * cardSpacing);
        const cardWidth = totalCardsWidth / keys.length;

        keys.forEach((key, idx) => {
          const cardX = margin + (idx * (cardWidth + cardSpacing));
          
          // Draw card background
          doc.fillColor('#eff6ff') // very light blue tint
             .roundedRect(cardX, currentY, cardWidth, summaryHeight, 3)
             .fill();
          
          doc.strokeColor('#dbeafe')
             .lineWidth(0.5)
             .roundedRect(cardX, currentY, cardWidth, summaryHeight, 3)
             .stroke();

          // Left primary color decorator line
          doc.fillColor(colors.primary)
             .rect(cardX, currentY, 3, summaryHeight)
             .fill();

          // Draw text
          doc.fillColor(colors.primary)
             .font('Helvetica-Bold')
             .fontSize(11)
             .text(String(summary[key]), cardX + 8, currentY + 6);

          doc.fillColor(colors.textLight)
             .font('Helvetica')
             .fontSize(7)
             .text(key, cardX + 8, currentY + 22, { width: cardWidth - 14, height: 14, ellipsis: true });
        });
        doc.restore();
        currentY += summaryHeight + 20;
      }

      // 5. Cierre Oficial: Signature & Seal block
      const signatureBlockHeight = 110;
      // If we don't have enough space at the bottom of the last page, we add a page
      if (currentY + signatureBlockHeight > pageHeight - margin - 35) {
        doc.addPage();
        const headerEndY = drawCorporateHeader(margin);
        currentY = headerEndY + 20;
      } else {
        // Add vertical space before signature
        currentY += 10;
      }

      doc.save();
      const colWidthHalf = (printableWidth - 40) / 2;
      const signatureY = currentY + 45;

      // 5a. Signature Column (Left)
      const sigLineX = margin + 20;
      
      // Draw signature image if present, else draw empty line
      if (signatureBuffer) {
        try {
          doc.image(signatureBuffer, sigLineX + (colWidthHalf - 120) / 2, currentY - 5, { 
            width: 120, 
            height: 40,
            align: 'center' 
          });
        } catch (err) {
          logger.error(`Error rendering signature in PDF: ${err.message}`);
        }
      }

      // Signature line
      doc.strokeColor(colors.borderLight)
         .lineWidth(0.8)
         .moveTo(sigLineX, signatureY)
         .lineTo(sigLineX + colWidthHalf, signatureY)
         .stroke();

      // Signature Details
      doc.fillColor(colors.textDark)
         .font('Helvetica-Bold')
         .fontSize(7.5)
         .text(legalRepresentativeName, sigLineX, signatureY + 5, { width: colWidthHalf, align: 'center' });

      doc.fillColor(colors.textLight)
         .font('Helvetica')
         .fontSize(7)
         .text(legalRepresentativeRole, sigLineX, signatureY + 15, { width: colWidthHalf, align: 'center' });


      // 5b. Stamp Column (Right)
      const stampLineX = margin + 20 + colWidthHalf + 40;
      
      // Draw stamp image if present
      if (stampBuffer) {
        try {
          doc.image(stampBuffer, stampLineX + (colWidthHalf - 100) / 2, currentY - 15, { 
            width: 100, 
            height: 55,
            align: 'center' 
          });
        } catch (err) {
          logger.error(`Error rendering stamp in PDF: ${err.message}`);
        }
      }

      // Stamp line
      doc.strokeColor(colors.borderLight)
         .lineWidth(0.8)
         .moveTo(stampLineX, signatureY)
         .lineTo(stampLineX + colWidthHalf, signatureY)
         .stroke();

      // Stamp Details
      doc.fillColor(colors.textDark)
         .font('Helvetica-Bold')
         .fontSize(7.5)
         .text('Sello Institucional', stampLineX, signatureY + 5, { width: colWidthHalf, align: 'center' });

      doc.fillColor(colors.textLight)
         .font('Helvetica')
         .fontSize(7)
         .text('Validación de documentos oficiales', stampLineX, signatureY + 15, { width: colWidthHalf, align: 'center' });

      doc.restore();

      // 6. Two-Pass compilation: draw Page Footers for all buffered pages
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        
        const footerY = pageHeight - margin + 12;
        
        doc.save();
        // Thin footer divider
        doc.strokeColor(colors.borderLight)
           .lineWidth(0.3)
           .moveTo(margin, footerY - 4)
           .lineTo(pageWidth - margin, footerY - 4)
           .stroke();

        // Footer text
        doc.fillColor(colors.textLight)
           .font('Helvetica')
           .fontSize(6.5)
           .text(legalName, margin, footerY)
           .text('Este documento es un reporte del sistema de gestión corporativa RR.HH.', margin, footerY + 8)
           .text(`Página ${i + 1} de ${range.count}`, pageWidth - margin - 100, footerY, { width: 100, align: 'right' });
        
        doc.restore();
      }

      // Finalize document
      doc.end();

    } catch (err) {
      logger.error(`Failed to generate corporate report PDF: ${err.stack}`);
      reject(err);
    }
  });
}

module.exports = {
  generateCorporatePdf
};
