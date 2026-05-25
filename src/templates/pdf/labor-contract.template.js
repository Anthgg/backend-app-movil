const PDFDocument = require('pdfkit');
const { loadAsset } = require('../../utils/pdf-assets.util');
const { formatDateTime, formatDate } = require('../../utils/date-format.util');
const logger = require('../../shared/utils/logger');

function formatCurrency(amount, currency = 'PEN') {
  const numericAmount = Number(amount) || 0;
  const normalizedCurrency = String(currency || 'PEN').toUpperCase();
  const formattedAmount = new Intl.NumberFormat('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numericAmount);

  if (normalizedCurrency === 'PEN') {
    return `S/ ${formattedAmount}`;
  }

  return `${normalizedCurrency} ${formattedAmount}`;
}

function valueOrFallback(value, fallback = 'No especificado') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function translateWorkdayType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const labels = {
    full_time: 'Tiempo completo',
    'full-time': 'Tiempo completo',
    fulltime: 'Tiempo completo',
    part_time: 'Tiempo parcial',
    'part-time': 'Tiempo parcial',
    parttime: 'Tiempo parcial',
    hourly: 'Por horas'
  };

  return labels[normalized] || valueOrFallback(value);
}

function translateWorkMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const labels = {
    onsite: 'Presencial',
    presencial: 'Presencial',
    remote: 'Remoto',
    remoto: 'Remoto',
    hybrid: 'Hibrido',
    hibrido: 'Hibrido',
    'híbrido': 'Hibrido'
  };

  return labels[normalized] || valueOrFallback(value);
}

function translateStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const labels = {
    active: 'Activo',
    inactive: 'Inactivo',
    draft: 'Borrador',
    signed: 'Firmado',
    expired: 'Vencido',
    terminated: 'Terminado'
  };

  return labels[normalized] || valueOrFallback(value);
}

function resolveContractTitle(contractType, workdayType, isIndefinite) {
  const normalizedType = String(contractType || '').toLowerCase();
  const normalizedWorkday = String(workdayType || '').toLowerCase();

  if (normalizedWorkday.includes('part') || normalizedWorkday.includes('parcial')) {
    return 'CONTRATO DE TRABAJO A TIEMPO PARCIAL';
  }

  if (isIndefinite) {
    return 'CONTRATO DE TRABAJO A PLAZO INDETERMINADO';
  }

  if (normalizedType.includes('modalidad') || normalizedType.includes('sujeto')) {
    return 'CONTRATO DE TRABAJO SUJETO A MODALIDAD';
  }

  return 'CONTRATO DE TRABAJO A PLAZO FIJO';
}

function formatLongDate(date) {
  const parsed = date ? new Date(date) : new Date();
  const validDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre'
  ];

  return {
    day: String(validDate.getDate()),
    month: months[validDate.getMonth()],
    year: String(validDate.getFullYear())
  };
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
      const phone = companyConfig.phone || companyConfig.telefono || 'No configurado';
      
      const logoUrl = companyConfig.logoUrl || companyConfig.logo_url;
      const signatureUrl = companyConfig.signatureUrl || companyConfig.firma_url;
      
      const legalRepName = companyConfig.legalRepresentativeName || companyConfig.representante_legal || 'LUCIANO PARVINA EDGAR VICENTE';
      const legalRepRole = companyConfig.legalRepresentativeRole || companyConfig.cargo_representante || 'Representante Legal';
      const legalRepDocumentType = companyConfig.legalRepresentativeDocumentType || companyConfig.representante_documento_tipo || null;
      const legalRepDocumentNumber = companyConfig.legalRepresentativeDocumentNumber || companyConfig.representante_documento_numero || null;

      // 2. Datos del Trabajador y Contrato
      const workerName = valueOrFallback([worker.first_name, worker.paternal_last_name, worker.maternal_last_name].filter(Boolean).join(' ').trim());
      const documentNumber = valueOrFallback(worker.document_number);
      const workerDocumentType = valueOrFallback(worker.document_type, 'DNI');
      const workerAddress = valueOrFallback(worker.address);
      const positionName = valueOrFallback(contract.position_name);
      const areaName = valueOrFallback(contract.area_name);
      const contractType = valueOrFallback(contract.contract_type_name || contract.contract_type, 'Contrato laboral');
      const startDate = formatDate(contract.start_date || worker.hire_date) || 'No especificado';
      const endDate = contract.end_date ? formatDate(contract.end_date) : 'No aplica';
      const isIndefinite = !contract.end_date || String(contractType).toLowerCase().includes('indefinido');
      const salary = formatCurrency(contract.salary || contract.agreed_salary || 0, contract.currency || 'PEN');
      const modality = translateWorkMode(contract.work_mode || contract.modality);
      const workdayType = translateWorkdayType(contract.workday_type || contract.work_journey);
      const workSchedule = valueOrFallback(contract.work_schedule || contract.schedule || contract.shift_name);
      const workLocation = valueOrFallback(contract.branch_name || contract.project_name || contract.work_location || contract.location || 'Sede, obra o lugar asignado por LA EMPRESA');
      const supervisorName = valueOrFallback(contract.supervisor_name || contract.immediate_supervisor);
      const objectiveCause = valueOrFallback(contract.objective_cause || contract.causa_objetiva);
      const contractStatus = translateStatus(contract.status);
      const contractTitle = resolveContractTitle(contractType, contract.workday_type || contract.work_journey, isIndefinite);
      const currencyLabel = String(contract.currency || 'PEN').toUpperCase();
      const signingDate = formatLongDate(generatedAt);
      const city = valueOrFallback(companyConfig.city || companyConfig.ciudad || 'Lima');
      
      // Estilos
      const primaryColor = '#000000';
      const textColor = '#000000';
      const textLight = '#000000';

      const [logoBuffer, signatureBuffer] = await Promise.all([
        loadAsset(logoUrl),
        loadAsset(signatureUrl)
      ]);

      const marginTop = 57; // ~20mm
      const marginSide = 51; // ~18mm
      const marginBottom = 51; // ~18mm
      const doc = new PDFDocument({ 
        size: 'A4', 
        layout: 'portrait', 
        margins: { top: marginTop, bottom: marginBottom, left: marginSide, right: marginSide },
        bufferPages: true 
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width;
      const printableWidth = pageWidth - (marginSide * 2);
      const contentText = (text, options = {}) => {
        doc.text(text, marginSide, doc.y, {
          width: printableWidth,
          ...options
        });
      };

      // FUNCIONES DE DIBUJO

      const drawHeader = () => {
        doc.save();
        const logoSize = 42;
        const logoX = marginSide + 12;
        const logoY = marginTop + 12;
        const leftX = marginSide + logoSize + 36;
        const rightWidth = 150;
        const rightX = pageWidth - marginSide - rightWidth;
        const leftWidth = rightX - leftX - 18;
        const headerBottom = marginTop + 84;
        
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, logoX, logoY, { width: logoSize, height: logoSize });
          } catch (e) {
            // fallback
          }
        }
        
        doc.fillColor(primaryColor)
           .font('Helvetica-Bold')
           .fontSize(11)
           .text(legalName, leftX, marginTop + 6, {
             width: leftWidth,
             height: 13,
             lineBreak: false
           });
           
        doc.fillColor(textLight)
           .font('Helvetica')
           .fontSize(8)
           .text('Nombre comercial: FABRYOR', leftX, marginTop + 20, {
             width: leftWidth,
             height: 10,
             lineBreak: false
           })
           .text(`RUC: ${ruc}`, leftX, marginTop + 31, {
             width: leftWidth,
             height: 10,
             lineBreak: false
           })
           .text(`Dir: ${fiscalAddress}`, leftX, marginTop + 42, {
             width: leftWidth,
             height: 20,
             lineBreak: true
           });

        if (phone !== 'No configurado') {
          doc.text(`Tel: ${phone}`, leftX, marginTop + 64, {
            width: leftWidth,
            height: 10,
            lineBreak: false
          });
        }
           
        doc.fontSize(8)
           .text(`Código: F-RRHH-CTR-01`, rightX, marginTop + 6, {
             width: rightWidth,
             height: 10,
             align: 'right',
             lineBreak: false
           })
           .text(`Generado: ${formatDateTime(generatedAt)}`, rightX, marginTop + 18, {
             width: rightWidth,
             height: 10,
             align: 'right',
             lineBreak: false
           });

        doc.moveTo(marginSide, headerBottom)
           .lineTo(pageWidth - marginSide, headerBottom)
           .lineWidth(1)
           .strokeColor(primaryColor)
           .stroke();
           
        doc.restore();
        doc.y = headerBottom + 24;
      };

      const drawFooter = () => {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          doc.save();
          const originalBottom = doc.page.margins.bottom;
          doc.page.margins.bottom = 0;

          const footerY = doc.page.height - 40;
          doc.moveTo(marginSide, footerY - 5)
             .lineTo(pageWidth - marginSide, footerY - 5)
             .lineWidth(0.5)
             .strokeColor('#dddddd')
             .stroke();

          doc.fillColor(textLight)
             .font('Helvetica-Oblique')
             .fontSize(7)
             .text('Documento generado por el Sistema de Gestion de RR.HH. - FABRYOR', marginSide, footerY, {
               width: printableWidth - 80,
               height: 10,
               lineBreak: false
             });

          doc.text(`Pagina ${i + 1} de ${range.count}`, pageWidth - marginSide - 70, footerY, {
            width: 70,
            height: 10,
            align: 'right',
            lineBreak: false
          });

          doc.page.margins.bottom = originalBottom;
          doc.restore();
        }
      };

      // TÍTULO
      const paragraphOptions = { width: printableWidth, align: 'justify', lineGap: 3 };

      const ensureSpace = (requiredHeight) => {
        if (doc.y + requiredHeight > doc.page.height - marginBottom - 18) {
          doc.addPage();
          doc.y = marginTop;
        }
      };

      const addParagraph = (text, options = {}) => {
        const content = String(text || '');
        doc.font('Helvetica').fontSize(10.5).fillColor(textColor);
        const height = doc.heightOfString(content, { ...paragraphOptions, ...options });
        ensureSpace(height + 8);
        contentText(content, { ...paragraphOptions, ...options });
        doc.moveDown(0.45);
      };

      const addClause = (numberText, title, text) => {
        doc.font('Helvetica-Bold').fontSize(10.8).fillColor(textColor);
        ensureSpace(38);
        contentText(`${numberText}: ${title}`, { width: printableWidth, lineGap: 1 });
        doc.moveDown(0.25);
        addParagraph(text);
      };

      const addSummaryTable = () => {
        const rows = [
          ['Trabajador', workerName],
          [workerDocumentType, documentNumber],
          ['Cargo', positionName],
          ['Area', areaName],
          ['Tipo de contrato', contractTitle],
          ['Fecha de inicio', startDate],
          ['Fecha de fin', endDate],
          ['Jornada', workdayType],
          ['Modalidad', modality],
          ['Moneda', currencyLabel],
          ['Sueldo', salary],
          ['Estado', contractStatus]
        ];
        const labelWidth = 130;
        const rowHeight = 16;
        const tableHeight = rows.length * rowHeight;

        ensureSpace(tableHeight + 34);
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(10.8).fillColor(textColor);
        contentText('RESUMEN CONTRACTUAL', { width: printableWidth });
        doc.moveDown(0.35);

        let y = doc.y;
        rows.forEach(([label, value]) => {
          doc.rect(marginSide, y, labelWidth, rowHeight).lineWidth(0.5).strokeColor('#d1d5db').stroke();
          doc.rect(marginSide + labelWidth, y, printableWidth - labelWidth, rowHeight).lineWidth(0.5).strokeColor('#d1d5db').stroke();
          doc.font('Helvetica-Bold').fontSize(8.7).fillColor(textColor)
             .text(label, marginSide + 6, y + 4, { width: labelWidth - 12, height: rowHeight - 4, lineBreak: false });
          doc.font('Helvetica').fontSize(8.7)
             .text(String(value || 'No especificado'), marginSide + labelWidth + 6, y + 4, {
               width: printableWidth - labelWidth - 12,
               height: rowHeight - 4,
               lineBreak: false
             });
          y += rowHeight;
        });
        doc.y = y + 10;
      };

      const drawSignaturesAtBottom = () => {
        const signatureHeight = 148;
        const signatureTopLimit = doc.page.height - marginBottom - signatureHeight - 12;

        if (doc.y > signatureTopLimit) {
          doc.addPage();
        }

        const sigY = doc.page.height - marginBottom - 100;
        const fingerprintWidth = 42;
        const fingerprintGap = 14;
        const availableForSignatures = printableWidth - fingerprintWidth - fingerprintGap;
        const colHalf = availableForSignatures / 2;
        const empX = marginSide;
        const traX = marginSide + colHalf;
        const lineInset = 10;
        const boxWidth = colHalf - 22;
        const textTop = sigY + 9;

        doc.save();
        if (signatureBuffer) {
          try {
            doc.image(signatureBuffer, empX + (boxWidth - 90) / 2 + lineInset, sigY - 43, { width: 90, height: 30 });
          } catch (e) {
            // Signature image is optional.
          }
        }

        doc.moveTo(empX + lineInset, sigY).lineTo(empX + boxWidth, sigY).strokeColor(textColor).lineWidth(0.8).stroke();
        doc.fillColor(textColor).font('Helvetica-Bold').fontSize(8.2).text('LA EMPRESA', empX + lineInset, textTop, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(7).text(legalName, empX + lineInset, textTop + 14, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica').fontSize(7).text(`RUC: ${ruc}`, empX + lineInset, textTop + 26, { width: boxWidth - lineInset, align: 'center' });
        doc.text('Representante Legal:', empX + lineInset, textTop + 38, { width: boxWidth - lineInset, align: 'center' });
        doc.text(legalRepName, empX + lineInset, textTop + 49, { width: boxWidth - lineInset, align: 'center' });

        doc.moveTo(traX + lineInset, sigY).lineTo(traX + boxWidth, sigY).strokeColor(textColor).lineWidth(0.8).stroke();
        doc.fillColor(textColor).font('Helvetica-Bold').fontSize(8.2).text('EL TRABAJADOR', traX + lineInset, textTop, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(7).text(workerName, traX + lineInset, textTop + 14, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica').fontSize(7).text(`${workerDocumentType}: ${documentNumber}`, traX + lineInset, textTop + 38, { width: boxWidth - lineInset, align: 'center' });

        const fingerprintX = pageWidth - marginSide - fingerprintWidth;
        doc.rect(fingerprintX, sigY - 12, fingerprintWidth, 58).lineWidth(0.5).strokeColor(textColor).stroke();
        doc.fillColor(textColor).font('Helvetica').fontSize(5.7).text('Huella digital', fingerprintX + 3, sigY + 12, { width: fingerprintWidth - 6, align: 'center' });
        doc.restore();
      };

      const renderFormalContract = () => {
        const legalRepDocument = legalRepDocumentType && legalRepDocumentNumber
          ? `, identificado con ${legalRepDocumentType} N. ${legalRepDocumentNumber}`
          : '';

        drawHeader();
        doc.fillColor(primaryColor)
           .font('Helvetica-Bold')
           .fontSize(15)
           .text(contractTitle, marginSide, doc.y, { width: printableWidth, align: 'center' });
        doc.moveDown(1);

        addParagraph(`Conste por el presente documento el Contrato de Trabajo que celebran, de una parte, ${legalName}, identificada con RUC N. ${ruc}, con domicilio en ${fiscalAddress}, debidamente representada por el Sr. ${legalRepName}${legalRepDocument}, en su calidad de ${legalRepRole}, a quien en adelante se denominara LA EMPRESA; y, de la otra parte, ${workerName}, identificado con ${workerDocumentType} N. ${documentNumber}, con domicilio en ${workerAddress}, a quien en adelante se denominara EL TRABAJADOR; quienes convienen celebrar el presente contrato laboral bajo el regimen laboral privado aplicable, de conformidad con la normativa laboral peruana vigente, en los terminos y condiciones siguientes:`);

        addClause('PRIMERA', 'OBJETO DEL CONTRATO', `LA EMPRESA contrata los servicios personales de EL TRABAJADOR para desempenar el cargo de ${positionName}, perteneciente al area de ${areaName}, bajo relacion de subordinacion, conforme a las instrucciones, politicas internas, reglamentos y necesidades operativas de LA EMPRESA.`);
        addClause('SEGUNDA', 'CARGO, FUNCIONES Y DEPENDENCIA', `EL TRABAJADOR prestara servicios en el cargo de ${positionName}, dentro del area de ${areaName}, en ${workLocation}. Su jefe inmediato sera ${supervisorName}. Sus funciones comprenden las actividades propias del cargo, la ejecucion diligente de las tareas asignadas y aquellas labores conexas que resulten razonables por la naturaleza del puesto.`);
        addClause('TERCERA', 'FECHA DE INICIO Y DURACION', isIndefinite ? `El presente contrato inicia el ${startDate} y tiene naturaleza indeterminada, conforme al regimen laboral privado aplicable.` : `El presente contrato inicia el ${startDate} y culmina el ${endDate}. La contratacion responde a la causa objetiva siguiente: ${objectiveCause}.`);
        addClause('CUARTA', 'PERIODO DE PRUEBA', 'EL TRABAJADOR estara sujeto al periodo de prueba legal de tres meses, conforme a la normativa laboral peruana aplicable, salvo que por la naturaleza del cargo corresponda una condicion distinta debidamente sustentada por LA EMPRESA.');
        addClause('QUINTA', 'REMUNERACION', `LA EMPRESA abonara a EL TRABAJADOR una remuneracion mensual de ${salary}, sujeta a los descuentos legales, tributarios, previsionales y demas retenciones que correspondan conforme a ley.`);
        addClause('SEXTA', 'JORNADA Y HORARIO DE TRABAJO', `EL TRABAJADOR cumplira una jornada de ${workdayType}, bajo modalidad ${modality}. El horario asignado sera ${workSchedule}, incluyendo los descansos que correspondan de acuerdo con la normativa vigente, las politicas internas y las necesidades operativas de LA EMPRESA.`);
        addClause('SETIMA', 'LUGAR DE PRESTACION DEL SERVICIO', `EL TRABAJADOR prestara servicios en ${workLocation}. LA EMPRESA podra reasignar el lugar de prestacion del servicio, sede u obra asignada cuando existan necesidades operativas, respetando la normativa laboral aplicable y las condiciones esenciales de la relacion laboral.`);
        addClause('OCTAVA', 'OBLIGACIONES DEL TRABAJADOR', 'EL TRABAJADOR se obliga a: a) Cumplir su horario de trabajo. b) Registrar asistencia. c) Ejecutar sus funciones con diligencia, responsabilidad y buena fe. d) Cumplir reglamentos internos, politicas y procedimientos de LA EMPRESA. e) Usar correctamente equipos, herramientas e implementos asignados. f) Guardar confidencialidad sobre informacion interna. g) Informar incidencias, ausencias o situaciones que afecten sus labores. h) Cumplir las normas de seguridad y salud en el trabajo.');
        addClause('NOVENA', 'OBLIGACIONES DE LA EMPRESA', 'LA EMPRESA se obliga a: a) Pagar la remuneracion pactada. b) Brindar condiciones razonables para la prestacion del servicio. c) Cumplir sus obligaciones laborales, tributarias y previsionales. d) Registrar y conservar la documentacion laboral correspondiente. e) Respetar los derechos laborales aplicables a EL TRABAJADOR.');
        addClause('DECIMA', 'ASISTENCIA, TARDANZAS E INASISTENCIAS', 'EL TRABAJADOR debera registrar su entrada y salida mediante los mecanismos establecidos por LA EMPRESA. Las tardanzas, inasistencias injustificadas, salidas no autorizadas o registros irregulares podran generar descuentos, observaciones o medidas disciplinarias conforme a ley, al reglamento interno y a las politicas aplicables.');
        addClause('DECIMA PRIMERA', 'CONFIDENCIALIDAD', 'EL TRABAJADOR no podra divulgar informacion interna, tecnica, comercial, operativa, administrativa, contractual, de clientes o de cualquier otra naturaleza a la que acceda por razon de sus funciones, incluso despues de concluida la relacion laboral.');
        addClause('DECIMA SEGUNDA', 'DOCUMENTOS Y VERACIDAD DE LA INFORMACION', 'EL TRABAJADOR declara que los datos, antecedentes y documentos entregados a LA EMPRESA son veraces. La falsedad, omision o adulteracion de informacion podra generar las medidas laborales o legales que correspondan.');
        addClause('DECIMA TERCERA', 'SEGURIDAD Y SALUD EN EL TRABAJO', 'EL TRABAJADOR se obliga a cumplir las politicas de seguridad y salud en el trabajo, las medidas de prevencion de riesgos, las capacitaciones, instrucciones de seguridad y el uso correcto de equipos de proteccion personal cuando corresponda.');
        addClause('DECIMA CUARTA', 'TERMINACION DEL CONTRATO', 'El presente contrato podra terminar por renuncia, despido conforme a ley, mutuo acuerdo, causa objetiva, vencimiento del plazo cuando corresponda u otra causal prevista por la normativa laboral peruana aplicable.');
        addClause('DECIMA QUINTA', 'ACEPTACION', `Leido el presente documento por ambas partes, y en senal de conformidad con todas sus clausulas, lo suscriben en dos ejemplares de igual valor, en la ciudad de ${city}, a los ${signingDate.day} dias del mes de ${signingDate.month} de ${signingDate.year}.`);

        addSummaryTable();
        drawSignaturesAtBottom();
      };

      renderFormalContract();
      drawFooter();
      doc.end();
      return;

    } catch (err) {
      logger.error(`Failed to generate labor contract PDF: ${err.stack}`);
      reject(err);
    }
  });
}

module.exports = {
  generateLaborContractPdf
};
