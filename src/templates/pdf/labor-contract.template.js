const PDFDocument = require('pdfkit');
const { loadAsset } = require('../../utils/pdf-assets.util');
const { formatDateTime, formatDate } = require('../../utils/date-format.util');
const logger = require('../../shared/utils/logger');

function formatCurrency(amount, currency = 'PEN') {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(Number(amount) || 0);
}

/**
 * Genera el documento PDF formal del contrato laboral
 * 
 * @param {Object} payload
 * @param {Object} payload.contract - Datos del contrato (monto, tipo, fechas)
 * @param {Object} payload.worker - Datos del trabajador (nombres, dni)
 * @param {Object} payload.companyConfig - Datos de la empresa (logo, ruc, firmas, colores)
 * @param {string} payload.generatedBy - Usuario que genera el reporte
 * @param {Date} payload.generatedAt - Fecha de generación
 * @returns {Promise<Buffer>}
 */
async function generateLaborContractPdf({
  contract = {},
  worker = {},
  companyConfig = {},
  documentType = 'contract',
  generatedBy = 'Sistema RR.HH.',
  generatedAt = new Date()
}) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Datos de Empresa
      const legalName = companyConfig.legalName || companyConfig.razon_social || 'FABRYOR SERVICIOS GENERALES S.A.C.';
      const ruc = companyConfig.ruc || '20605153136';
      const fiscalAddress = companyConfig.fiscalAddress || companyConfig.direccion_fiscal || 'S.J.M., Lima, Perú';
      const email = companyConfig.email || companyConfig.correo_corporativo || 'No configurado';
      const phone = companyConfig.phone || companyConfig.telefono || 'No configurado';
      
      const logoUrl = companyConfig.logoUrl || companyConfig.logo_url;
      const signatureUrl = companyConfig.signatureUrl || companyConfig.firma_url;
      const stampUrl = companyConfig.stampUrl || companyConfig.sello_url;
      
      const legalRepName = companyConfig.legalRepresentativeName || companyConfig.representante_legal || 'LUCIANO PARVINA EDGAR VICENTE';
      const legalRepRole = companyConfig.legalRepresentativeRole || companyConfig.cargo_representante || 'Representante Legal';

      // 2. Datos del Trabajador y Contrato
      const workerName = [worker.first_name, worker.paternal_last_name, worker.maternal_last_name].filter(Boolean).join(' ').trim();
      const documentNumber = worker.document_number || 'No especificado';
      const documentType = worker.document_type || 'DNI';
      const positionName = contract.position_name || 'No especificado';
      const areaName = contract.area_name || 'No especificado';
      const contractType = contract.contract_type_name || contract.contract_type || 'Contrato laboral';
      const startDate = formatDate(contract.start_date || worker.hire_date) || 'No especificado';
      const endDate = contract.end_date ? formatDate(contract.end_date) : 'No aplica';
      const isIndefinite = !contract.end_date || String(contractType).toLowerCase().includes('indefinido');
      const salary = formatCurrency(contract.salary || contract.agreed_salary || 0, contract.currency || 'PEN');
      const modality = contract.work_mode || contract.modality || 'No especificado';
      const workdayType = contract.workday_type || contract.work_journey || 'No especificado';
      
      // Estilos
      const primaryColor = companyConfig.colorPrimario || companyConfig.color_primario || '#1e3a8a';
      const textColor = '#333333';
      const textLight = '#666666';

      const [logoBuffer, signatureBuffer, stampBuffer] = await Promise.all([
        loadAsset(logoUrl),
        loadAsset(signatureUrl),
        loadAsset(stampUrl)
      ]);

      const margin = 50;
      const doc = new PDFDocument({ 
        size: 'A4', 
        layout: 'portrait', 
        margins: { top: margin, bottom: 60, left: margin, right: margin },
        bufferPages: true 
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width;
      const printableWidth = pageWidth - (margin * 2);

      // FUNCIONES DE DIBUJO

      const drawHeader = () => {
        doc.save();
        const logoSize = 50;
        
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, margin, margin, { width: logoSize, height: logoSize });
          } catch (e) {
            // fallback
          }
        }
        
        doc.fillColor(primaryColor)
           .font('Helvetica-Bold')
           .fontSize(11)
           .text(legalName, margin + logoSize + 15, margin, { width: 200 });
           
        doc.fillColor(textLight)
           .font('Helvetica')
           .fontSize(8)
           .text(`RUC: ${ruc}`, margin + logoSize + 15, margin + 15)
           .text(`Dir: ${fiscalAddress}`, margin + logoSize + 15, margin + 25)
           .text(`Email: ${email}`, margin + logoSize + 15, margin + 35);
           
        doc.fontSize(8)
           .text(`Código: F-RRHH-CTR-01`, pageWidth - margin - 150, margin, { align: 'right' })
           .text(`Generado: ${formatDateTime(generatedAt)}`, pageWidth - margin - 150, margin + 12, { align: 'right' });

        doc.moveTo(margin, margin + 60)
           .lineTo(pageWidth - margin, margin + 60)
           .lineWidth(1)
           .strokeColor(primaryColor)
           .stroke();
           
        doc.restore();
        doc.y = margin + 80;
      };

      const drawFooter = () => {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          doc.save();
          const originalBottom = doc.page.margins.bottom;
          doc.page.margins.bottom = 0;
          
          const footerY = doc.page.height - 40;
          doc.moveTo(margin, footerY - 5).lineTo(pageWidth - margin, footerY - 5).lineWidth(0.5).strokeColor('#dddddd').stroke();
          doc.fillColor(textLight)
             .font('Helvetica-Oblique')
             .fontSize(7)
             .text('Documento generado por el Sistema de Gestión de RR.HH. - FABRYOR', margin, footerY, { lineBreak: false });
             
          doc.text(`Página ${i + 1} de ${range.count}`, pageWidth - margin - 50, footerY, { width: 50, align: 'right', lineBreak: false });
          
          doc.page.margins.bottom = originalBottom;
          doc.restore();
        }
      };

      // TÍTULO
      drawHeader();
      
      doc.fillColor(primaryColor)
         .font('Helvetica-Bold')
         .fontSize(14)
         .text('CONTRATO DE TRABAJO', { align: 'center' });
         
      doc.fillColor(textLight)
         .font('Helvetica')
         .fontSize(10)
         .text(String(contractType).toUpperCase(), { align: 'center' });
         
      doc.moveDown(2);

      // PÁRRAFO DE INTRODUCCIÓN
      doc.fillColor(textColor)
         .font('Helvetica')
         .fontSize(10)
         .text('Conste por el presente documento el Contrato de Trabajo que celebran, de una parte, ', { continued: true, align: 'justify' })
         .font('Helvetica-Bold').text(`${legalName}, `, { continued: true })
         .font('Helvetica').text(`identificada con RUC N.º `, { continued: true })
         .font('Helvetica-Bold').text(`${ruc}, `, { continued: true })
         .font('Helvetica').text(`con domicilio en `, { continued: true })
         .font('Helvetica-Bold').text(`${fiscalAddress}, `, { continued: true })
         .font('Helvetica').text(`debidamente representada por su Representante Legal, el Sr. `, { continued: true })
         .font('Helvetica-Bold').text(`${legalRepName}, `, { continued: true })
         .font('Helvetica').text(`a quien en adelante se le denominará `, { continued: true })
         .font('Helvetica-Bold').text(`“LA EMPRESA”; `, { continued: true })
         .font('Helvetica').text(`y de la otra parte, el/la Sr(a). `, { continued: true })
         .font('Helvetica-Bold').text(`${workerName}, `, { continued: true })
         .font('Helvetica').text(`identificado/a con ${documentType} N.º `, { continued: true })
         .font('Helvetica-Bold').text(`${documentNumber}, `, { continued: true })
         .font('Helvetica').text(`a quien en adelante se le denominará `, { continued: true })
         .font('Helvetica-Bold').text(`“EL TRABAJADOR”; `, { continued: true })
         .font('Helvetica').text(`en los términos y condiciones siguientes:`);

      doc.moveDown();

      // CLÁUSULAS
      const addClause = (numberText, title, text) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`${numberText}: ${title}`);
        doc.font('Helvetica').fontSize(10).text(text, { align: 'justify' });
        doc.moveDown(0.8);
      };

      addClause('PRIMERA', 'OBJETO DEL CONTRATO', 
        `LA EMPRESA contrata los servicios de EL TRABAJADOR para desempeñar el cargo de ${positionName}, perteneciente al área de ${areaName}, realizando las funciones asignadas por su jefe inmediato y aquellas relacionadas con la naturaleza del puesto.`
      );

      addClause('SEGUNDA', 'INICIO Y DURACIÓN', 
        `El presente contrato inicia el día ${startDate}. El tipo de contrato será ${isIndefinite ? 'indefinido' : `temporal, finalizando el ${endDate}`}, salvo que las partes acuerden una modificación conforme a la normativa laboral vigente.`
      );

      addClause('TERCERA', 'PERIODO DE PRUEBA', 
        `EL TRABAJADOR estará sujeto a un periodo de prueba conforme a la legislación laboral aplicable. Durante dicho periodo, LA EMPRESA evaluará su desempeño, puntualidad, responsabilidad, cumplimiento de funciones y adaptación al puesto.`
      );

      addClause('CUARTA', 'REMUNERACIÓN', 
        `LA EMPRESA abonará a EL TRABAJADOR una remuneración mensual de ${salary}, sujeta a los descuentos legales, tributarios, previsionales y demás conceptos autorizados por ley.`
      );

      addClause('QUINTA', 'JORNADA Y MODALIDAD DE TRABAJO', 
        `EL TRABAJADOR cumplirá una jornada laboral de tipo ${workdayType.toLowerCase()}, bajo modalidad ${modality.toLowerCase()}, en las instalaciones, sedes, obras o lugares que LA EMPRESA determine según sus necesidades operativas.`
      );

      addClause('SEXTA', 'OBLIGACIONES DEL TRABAJADOR', 
        `EL TRABAJADOR se obliga a:
a) Cumplir puntualmente con su horario de trabajo.
b) Registrar correctamente su asistencia de entrada y salida.
c) Desempeñar sus funciones con responsabilidad, eficiencia y buena fe.
d) Respetar las normas internas, políticas de seguridad, procedimientos operativos y disposiciones de LA EMPRESA.
e) Mantener reserva sobre la información confidencial a la que tenga acceso.
f) Cuidar los bienes, equipos, documentos, herramientas y recursos entregados por LA EMPRESA.
g) Informar oportunamente cualquier incidencia, ausencia, tardanza o situación que afecte el cumplimiento de sus labores.`
      );

      // Validar si necesitamos salto de página para la siguiente cláusula grande
      if (doc.y + 120 > doc.page.height - 60 && doc.y > margin) doc.addPage();

      addClause('SÉTIMA', 'OBLIGACIONES DE LA EMPRESA', 
        `LA EMPRESA se obliga a:
a) Pagar la remuneración acordada en la forma y oportunidad correspondiente.
b) Brindar las condiciones necesarias para el desarrollo de las labores.
c) Cumplir con las obligaciones laborales, administrativas y de seguridad aplicables.
d) Registrar y conservar la documentación laboral correspondiente.`
      );

      addClause('OCTAVA', 'ASISTENCIA, TARDANZAS Y FALTAS', 
        `EL TRABAJADOR deberá registrar su asistencia mediante los mecanismos establecidos por LA EMPRESA. Las tardanzas, inasistencias injustificadas, salidas no autorizadas o registros irregulares podrán generar descuentos, observaciones, medidas disciplinarias o las acciones que correspondan conforme al reglamento interno y la normativa vigente.`
      );

      addClause('NOVENA', 'CONFIDENCIALIDAD', 
        `EL TRABAJADOR se compromete a no divulgar información interna, comercial, operativa, administrativa, técnica, contractual o de cualquier otra naturaleza perteneciente a LA EMPRESA, incluso después de terminada la relación laboral.`
      );

      addClause('DÉCIMA', 'DOCUMENTOS Y VERACIDAD DE LA INFORMACIÓN', 
        `EL TRABAJADOR declara que la información y documentos entregados a LA EMPRESA son verdaderos. Cualquier falsedad, omisión o adulteración podrá ser considerada falta grave, sin perjuicio de las acciones legales correspondientes.`
      );

      addClause('DÉCIMA PRIMERA', 'TERMINACIÓN DEL CONTRATO', 
        `El presente contrato podrá finalizar por renuncia, despido, mutuo acuerdo, causa legal, incumplimiento de obligaciones o cualquier otra causal permitida por la normativa laboral vigente.`
      );

      addClause('DÉCIMA SEGUNDA', 'ACEPTACIÓN', 
        `Ambas partes declaran haber leído el presente contrato, aceptando su contenido y obligándose a cumplir cada una de sus cláusulas.`
      );
      
      doc.font('Helvetica').fontSize(10).text('En señal de conformidad, se firma el presente documento en dos ejemplares de igual valor.');
      
      doc.moveDown(2);

      // TABLA RESUMEN (Pequeña tabla central)
      if (doc.y + 180 > doc.page.height - 60 && doc.y > margin) doc.addPage();
      
      doc.font('Helvetica-Bold').fontSize(10).text('RESUMEN CONTRACTUAL', { align: 'center' });
      doc.moveDown(0.5);
      
      const summaryData = [
        ['Trabajador', workerName],
        ['DNI', documentNumber],
        ['Cargo', positionName],
        ['Área', areaName],
        ['Tipo de contrato', contractType],
        ['Inicio / Fin', `${startDate} / ${endDate}`],
        ['Modalidad', `${modality} - ${workdayType}`],
        ['Sueldo', salary]
      ];

      const tableTop = doc.y;
      const rowHeight = 15;
      let curY = tableTop;
      
      doc.save();
      doc.lineWidth(0.5).strokeColor('#aaaaaa');
      
      summaryData.forEach((row, i) => {
        // bg
        if (i % 2 === 0) {
          doc.fillColor('#f9f9f9').rect(margin + 50, curY, printableWidth - 100, rowHeight).fill();
        }
        
        doc.fillColor(textColor)
           .font('Helvetica-Bold').fontSize(8)
           .text(row[0], margin + 55, curY + 4, { width: 120 });
           
        doc.font('Helvetica').fontSize(8)
           .text(row[1], margin + 180, curY + 4);
           
        // row separator
        doc.moveTo(margin + 50, curY + rowHeight).lineTo(margin + 50 + printableWidth - 100, curY + rowHeight).stroke();
        
        curY += rowHeight;
      });
      // border box
      doc.rect(margin + 50, tableTop, printableWidth - 100, curY - tableTop).stroke();
      doc.restore();

      doc.y = curY + 60;

      // FIRMAS Y SELLOS
      // Ensure enough space for signatures without creating blank pages
      if (doc.y + 120 > doc.page.height - 60 && doc.y > margin) doc.addPage();
      
      const sigY = doc.y;
      const colHalf = printableWidth / 2;
      
      doc.save();
      
      // LA EMPRESA (Izq)
      const empX = margin;
      if (signatureBuffer) {
        try { doc.image(signatureBuffer, empX + (colHalf - 120) / 2 - 20, sigY - 45, { width: 120, height: 40 }); } catch (e) {}
      }
      doc.moveTo(empX + 20, sigY).lineTo(empX + colHalf - 40, sigY).strokeColor('#666').lineWidth(0.8).stroke();
      doc.fillColor(textColor).font('Helvetica-Bold').fontSize(9).text('LA EMPRESA', empX + 20, sigY + 5, { width: colHalf - 60, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8).text(legalName, empX + 20, sigY + 18, { width: colHalf - 60, align: 'center' });
      doc.font('Helvetica').fontSize(8).text(`RUC: ${ruc}`, empX + 20, sigY + 28, { width: colHalf - 60, align: 'center' });
      doc.text(`Rep. Legal: ${legalRepName}`, empX + 20, sigY + 38, { width: colHalf - 60, align: 'center' });

      // EL TRABAJADOR (Der)
      const traX = margin + colHalf;
      doc.moveTo(traX + 20, sigY).lineTo(traX + colHalf - 40, sigY).strokeColor('#666').lineWidth(0.8).stroke();
      doc.fillColor(textColor).font('Helvetica-Bold').fontSize(9).text('EL TRABAJADOR', traX + 20, sigY + 5, { width: colHalf - 60, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8).text(workerName, traX + 20, sigY + 18, { width: colHalf - 60, align: 'center' });
      doc.font('Helvetica').fontSize(8).text(`DNI: ${documentNumber}`, traX + 20, sigY + 28, { width: colHalf - 60, align: 'center' });

      // Sello flotante condicional
      if (stampBuffer && documentType !== 'contract') {
        try { doc.image(stampBuffer, pageWidth / 2 - 50, sigY - 60, { width: 100, height: 55 }); } catch (e) {}
      }

      // Huella (Opcional, dibujar un recuadro)
      doc.rect(traX + colHalf - 35, sigY - 50, 40, 50).lineWidth(0.5).strokeColor('#cccccc').stroke();
      doc.fillColor('#aaaaaa').font('Helvetica').fontSize(6).text('Huella digital', traX + colHalf - 35, sigY - 30, { width: 40, align: 'center' });

      doc.restore();

      drawFooter();
      doc.end();

    } catch (err) {
      logger.error(`Failed to generate labor contract PDF: ${err.stack}`);
      reject(err);
    }
  });
}

module.exports = {
  generateLaborContractPdf
};
