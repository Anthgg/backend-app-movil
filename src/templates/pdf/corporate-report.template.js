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
 * @param {Array} [payload.infoSections] - Adaptive report information sections
 * @param {string} [payload.infoSectionsLayout] - stacked or combined-two-column
 * @param {Array} payload.columns - Columns definition [{ key, label, widthRatio }]
 * @param {Array} payload.rows - Rows data
 * @param {Object} [payload.summary] - Stat cards for report summary
 * @param {boolean} [payload.showSummaryCards] - Whether to draw summary cards
 * @param {string} [payload.signatureMode] - fixed or flow
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
  infoSections = [],
  infoSectionsLayout = 'stacked',
  columns = [],
  rows = [],
  summary = null,
  showSummaryCards = true,
  signatureMode = 'fixed',
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
        margins: { top: margin, bottom: 10, left: margin, right: margin },
        bufferPages: true 
      });


      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const printableWidth = pageWidth - (margin * 2);
      const contentBottomY = pageHeight - margin - 40;

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

      const addContentPage = () => {
        doc.addPage();
        const headerEndY = drawCorporateHeader(margin);
        return headerEndY + 15;
      };

      const ensureFlowSpace = (y, requiredHeight) => {
        if (y + requiredHeight <= contentBottomY) return y;
        return addContentPage();
      };

      const measureInfoRow = (row, labelWidth, valueWidth, fontSize) => {
        const label = `${row.label || ''}:`;
        const value = row.value === undefined || row.value === null || row.value === ''
          ? 'No especificado'
          : String(row.value);

        doc.font('Helvetica-Bold').fontSize(fontSize);
        const labelHeight = doc.heightOfString(label, { width: labelWidth });
        doc.font('Helvetica').fontSize(fontSize);
        const valueHeight = doc.heightOfString(value, { width: valueWidth });

        return Math.max(14, labelHeight, valueHeight) + 3;
      };

      const calculateInfoBox = ({ rows = [], width, labelWidth = 115, fontSize = 8 }) => {
        const padding = 10;
        const rowGap = 2;
        const titleHeight = 14;
        const valueWidth = width - (padding * 2) - labelWidth;
        const measuredRows = rows.map((row) => ({
          ...row,
          height: measureInfoRow(row, labelWidth, valueWidth, fontSize)
        }));
        const rowsHeight = measuredRows.reduce((total, row) => total + row.height + rowGap, 0);

        return {
          padding,
          rowGap,
          titleHeight,
          valueWidth,
          measuredRows,
          boxHeight: padding + titleHeight + 4 + rowsHeight + padding
        };
      };

      const drawInfoBox = ({ title, rows = [], labelWidth = 115, fontSize = 8 }, y) => {
        if (!Array.isArray(rows) || rows.length === 0) return y;

        const box = calculateInfoBox({ rows, width: printableWidth, labelWidth, fontSize });
        y = ensureFlowSpace(y, box.boxHeight);

        doc.save();
        doc.fillColor(colors.bgLight)
           .roundedRect(margin, y, printableWidth, box.boxHeight, 5)
           .fill();
        doc.strokeColor(colors.borderLight)
           .lineWidth(0.5)
           .roundedRect(margin, y, printableWidth, box.boxHeight, 5)
           .stroke();

        doc.fillColor(colors.primary)
           .font('Helvetica-Bold')
           .fontSize(8)
           .text(String(title || 'INFORMACION'), margin + box.padding, y + box.padding, {
             width: printableWidth - (box.padding * 2)
           });

        let rowY = y + box.padding + box.titleHeight + 4;
        box.measuredRows.forEach((row) => {
          const value = row.value === undefined || row.value === null || row.value === ''
            ? 'No especificado'
            : String(row.value);

          doc.fillColor(colors.textLight)
             .font('Helvetica-Bold')
             .fontSize(fontSize)
             .text(`${row.label}:`, margin + box.padding, rowY, { width: labelWidth });

          doc.fillColor(colors.textDark)
             .font('Helvetica')
             .fontSize(fontSize)
             .text(value, margin + box.padding + labelWidth, rowY, {
               width: box.valueWidth,
               lineBreak: true
             });

          rowY += row.height + box.rowGap;
        });
        doc.restore();

        return y + box.boxHeight + 10;
      };

      const calculateInfoColumn = ({ rows = [], width, labelWidth, fontSize = 8 }) => {
        const rowGap = 2;
        const titleHeight = 12;
        const valueWidth = Math.max(30, width - labelWidth);
        const measuredRows = rows.map((row) => ({
          ...row,
          height: measureInfoRow(row, labelWidth, valueWidth, fontSize)
        }));
        const rowsHeight = measuredRows.reduce((total, row) => total + row.height + rowGap, 0);

        return {
          rowGap,
          titleHeight,
          valueWidth,
          measuredRows,
          height: titleHeight + 6 + rowsHeight
        };
      };

      const drawInfoSectionPair = (sections, y) => {
        const validSections = sections.filter((section) => Array.isArray(section.rows) && section.rows.length > 0);
        if (validSections.length === 0) return y;

        const padding = 10;
        const columnGap = validSections.length > 1 ? 18 : 0;
        const contentWidth = printableWidth - (padding * 2);
        const columnWidth = validSections.length > 1
          ? (contentWidth - columnGap) / 2
          : contentWidth;
        const columns = validSections.map((section) => {
          const labelWidth = section.labelWidth || (validSections.length > 1 ? 82 : 115);
          const fontSize = section.fontSize || 8;
          return {
            ...section,
            labelWidth,
            fontSize,
            layout: calculateInfoColumn({
              rows: section.rows,
              width: columnWidth,
              labelWidth,
              fontSize
            })
          };
        });
        const contentHeight = Math.max(...columns.map((column) => column.layout.height));
        const boxHeight = padding + contentHeight + padding;

        y = ensureFlowSpace(y, boxHeight);

        doc.save();
        doc.fillColor(colors.bgLight)
           .roundedRect(margin, y, printableWidth, boxHeight, 5)
           .fill();
        doc.strokeColor(colors.borderLight)
           .lineWidth(0.5)
           .roundedRect(margin, y, printableWidth, boxHeight, 5)
           .stroke();

        if (columns.length > 1) {
          const dividerX = margin + padding + columnWidth + (columnGap / 2);
          doc.strokeColor(colors.borderLight)
             .lineWidth(0.5)
             .moveTo(dividerX, y + padding)
             .lineTo(dividerX, y + boxHeight - padding)
             .stroke();
        }

        columns.forEach((section, index) => {
          const x = margin + padding + (index * (columnWidth + columnGap));
          const layout = section.layout;

          doc.fillColor(colors.primary)
             .font('Helvetica-Bold')
             .fontSize(8)
             .text(String(section.title || 'INFORMACION'), x, y + padding, {
               width: columnWidth
             });

          let rowY = y + padding + layout.titleHeight + 6;
          layout.measuredRows.forEach((row) => {
            const value = row.value === undefined || row.value === null || row.value === ''
              ? 'No especificado'
              : String(row.value);

            doc.fillColor(colors.textLight)
               .font('Helvetica-Bold')
               .fontSize(section.fontSize)
               .text(`${row.label}:`, x, rowY, { width: section.labelWidth });

            doc.fillColor(colors.textDark)
               .font('Helvetica')
               .fontSize(section.fontSize)
               .text(value, x + section.labelWidth, rowY, {
                 width: layout.valueWidth,
                 lineBreak: true
               });

            rowY += row.height + layout.rowGap;
          });
        });

        doc.restore();
        return y + boxHeight + 10;
      };

      const drawCombinedInfoSections = (sections, y) => {
        const validSections = sections.filter((section) => Array.isArray(section.rows) && section.rows.length > 0);
        let nextY = y;

        for (let index = 0; index < validSections.length; index += 2) {
          nextY = drawInfoSectionPair(validSections.slice(index, index + 2), nextY);
        }

        return nextY;
      };

      const drawSignatureBlock = (y) => {
        const columnGap = 40;
        const columnWidth = (printableWidth - columnGap) / 2;
        const imageHeight = 45;
        const lineY = y + imageHeight + 8;
        const signatureX = margin;
        const sealX = margin + columnWidth + columnGap;

        doc.save();

        if (signatureBuffer) {
          try {
            doc.image(signatureBuffer, signatureX + 40, y, {
              fit: [columnWidth - 80, imageHeight],
              align: 'center'
            });
          } catch (err) {
            logger.error(`Error rendering signature in PDF: ${err.message}`);
          }
        }

        if (stampBuffer) {
          try {
            doc.image(stampBuffer, sealX + 40, y - 4, {
              fit: [columnWidth - 80, imageHeight + 8],
              align: 'center'
            });
          } catch (err) {
            logger.error(`Error rendering stamp in PDF: ${err.message}`);
          }
        }

        doc.strokeColor(colors.borderLight)
           .lineWidth(0.8)
           .moveTo(signatureX + 20, lineY)
           .lineTo(signatureX + columnWidth - 20, lineY)
           .stroke();

        doc.strokeColor(colors.borderLight)
           .lineWidth(0.8)
           .moveTo(sealX + 20, lineY)
           .lineTo(sealX + columnWidth - 20, lineY)
           .stroke();

        doc.fillColor(colors.textDark)
           .font('Helvetica-Bold')
           .fontSize(7.5)
           .text(legalRepresentativeName, signatureX, lineY + 6, { width: columnWidth, align: 'center' });

        doc.fillColor(colors.textLight)
           .font('Helvetica')
           .fontSize(7)
           .text(legalRepresentativeRole, signatureX, lineY + 18, { width: columnWidth, align: 'center' });

        doc.fillColor(colors.textDark)
           .font('Helvetica-Bold')
           .fontSize(7.5)
           .text('Sello Institucional', sealX, lineY + 6, { width: columnWidth, align: 'center' });

        doc.fillColor(colors.textLight)
           .font('Helvetica')
           .fontSize(7)
           .text('Validacion de documentos oficiales', sealX, lineY + 18, { width: columnWidth, align: 'center' });

        doc.restore();
        return lineY + 34;
      };

      // Draw initial header
      let currentY = drawCorporateHeader(margin);

      // Set document Y cursor below the header to prevent overlap
      doc.y = currentY + 20;

      // 2. Document Information (Metadata Box)
      // Report Title
      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(14)
         .text(reportTitle.toUpperCase(), margin, doc.y);

      currentY = doc.y;
      if (Array.isArray(infoSections) && infoSections.length > 0) {
        currentY += 12;
        if (infoSectionsLayout === 'combined-two-column') {
          currentY = drawCombinedInfoSections(infoSections, currentY);
        } else {
          infoSections.forEach((section) => {
            currentY = drawInfoBox(section, currentY);
          });
        }
        currentY += 2;
      } else {
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
      }

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
        let tableY = ensureFlowSpace(currentY, 28);
        tableY = drawTableHeader(tableY);

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
          if (tableY + rowHeight > contentBottomY) {
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
      if (showSummaryCards && summary && Object.keys(summary).length > 0) {
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
      const signatureBlockHeight = 92;
      if (signatureMode === 'flow') {
        currentY = ensureFlowSpace(currentY + 8, signatureBlockHeight);
        currentY = drawSignatureBlock(currentY);
      } else {
      const targetSignatureY = 690;

      // If we don't have enough space on the current page (meaning currentY has exceeded targetSignatureY),
      // we must add a page.
      if (currentY > targetSignatureY) {
        doc.addPage();
        drawCorporateHeader(margin);
      }

      // Always position the signatures at the exact target Y at the bottom of the page
      currentY = targetSignatureY;

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
      }

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
