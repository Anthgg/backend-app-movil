const PDFDocument = require('pdfkit');
const { loadAsset } = require('../../utils/pdf-assets.util');
const { formatDate, formatDateTime } = require('../../utils/date-format.util');
const logger = require('../../shared/utils/logger');
const { resolveRequestDocumentConfig } = require('../../services/request-service/services/requestDocument.config');

function valueOrFallback(value, fallback = 'No especificado') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function readPath(source, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => {
      if (current === null || current === undefined) return undefined;
      return current[key];
    }, source);
}

function firstValue(source, keys, fallback = 'No especificado') {
  for (const key of keys) {
    const value = readPath(source, key);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
}

function fullWorkerName(worker) {
  return valueOrFallback(
    [
      worker.first_name,
      worker.paternal_last_name,
      worker.maternal_last_name
    ].filter(Boolean).join(' ').trim()
    || worker.worker_name
    || worker.full_name
  );
}

function dateOnly(value) {
  if (!value) return 'No especificado';
  return formatDate(value);
}

function timeOnly(value) {
  if (!value) return 'No especificado';
  return String(value).slice(0, 5);
}

function resolveDaysRequested(request) {
  if (request.days_requested !== undefined && request.days_requested !== null) {
    return valueOrFallback(request.days_requested);
  }

  const start = request.start_date ? new Date(`${String(request.start_date).slice(0, 10)}T00:00:00Z`) : null;
  const end = request.end_date ? new Date(`${String(request.end_date).slice(0, 10)}T00:00:00Z`) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'No especificado';
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return days > 0 ? String(days) : 'No especificado';
}

function translateStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const labels = {
    draft: 'Borrador',
    pending: 'Pendiente',
    pending_supervisor: 'Pendiente de supervisor',
    pending_rrhh: 'Pendiente de RR.HH.',
    observed: 'Observada',
    approved: 'Aprobada',
    rejected: 'Rechazada',
    cancelled: 'Cancelada',
    expired: 'Expirada'
  };

  return labels[normalized] || valueOrFallback(value);
}

function formatBoolean(value) {
  if (value === true) return 'Si';
  if (value === false) return 'No';
  return valueOrFallback(value);
}

async function generateRequestDocumentPdf({
  request = {},
  worker = {},
  companyConfig = {},
  generatedBy = 'Sistema RR.HH.',
  generatedAt = new Date()
}) {
  return new Promise(async (resolve, reject) => {
    try {
      const config = resolveRequestDocumentConfig(request.type_code || request.type, request.type_name);
      const metadata = parseMetadata(request.metadata);

      const legalName = companyConfig.legalName || companyConfig.razon_social || request.company_name || 'FABRYOR SERVICIOS GENERALES S.A.C.';
      const commercialName = companyConfig.commercialName || companyConfig.nombre_comercial || 'FABRYOR';
      const ruc = companyConfig.ruc || request.company_ruc || '20605153136';
      const fiscalAddress = companyConfig.fiscalAddress || companyConfig.direccion_fiscal || request.company_address || 'S.J.M., Lima, Peru';
      const phone = companyConfig.phone || companyConfig.telefono || null;
      const logoUrl = companyConfig.logoUrl || companyConfig.logo_url;
      const signatureUrl = companyConfig.signatureUrl || companyConfig.firma_url;
      const city = valueOrFallback(companyConfig.city || companyConfig.ciudad || metadata.city || metadata.ciudad || 'Lima');
      const legalRepName = valueOrFallback(companyConfig.legalRepresentativeName || companyConfig.representante_legal || request.rrhh_responsible_name || 'Responsable de RR.HH.');
      const legalRepRole = valueOrFallback(companyConfig.legalRepresentativeRole || companyConfig.cargo_representante || 'Responsable de RR.HH.');

      const workerName = fullWorkerName(worker);
      const workerDocumentType = valueOrFallback(worker.document_type || metadata.trabajador_tipo_documento || 'DNI');
      const workerDocument = valueOrFallback(worker.document_number || metadata.trabajador_documento);
      const workerCode = valueOrFallback(worker.worker_code || worker.personal_id || worker.document_number || worker.id);
      const positionName = valueOrFallback(worker.position_name || worker.job_position_name || metadata.trabajador_cargo);
      const areaName = valueOrFallback(worker.area_name || worker.department_name || metadata.trabajador_area);
      const workLocationName = valueOrFallback(worker.work_location_name || worker.branch_name || metadata.trabajador_sede);
      const hireDate = dateOnly(worker.hire_date || worker.start_date || metadata.trabajador_fecha_ingreso);

      const requestCode = valueOrFallback(request.request_code || request.requestCode, 'F-RRHH-SOL-PENDIENTE');
      const requestTypeLabel = valueOrFallback(request.type_name || config.typeLabel);
      const startDate = dateOnly(request.start_date || metadata.startDate || metadata.fecha_inicio);
      const endDate = dateOnly(request.end_date || metadata.endDate || metadata.fecha_fin);
      const totalDays = resolveDaysRequested(request);
      const reason = valueOrFallback(request.reason || metadata.solicitud_motivo || metadata.reason);
      const statusLabel = translateStatus(request.status);
      const reviewDate = request.approved_at ? formatDateTime(request.approved_at) : 'Pendiente de revision';
      const rrhhResponsible = valueOrFallback(request.rrhh_responsible_name || request.approved_by_name || metadata.rrhh_responsable || legalRepName);
      const rrhhObservations = valueOrFallback(request.hr_comment || metadata.rrhh_observaciones, 'Sin observaciones registradas');

      const [logoBuffer, signatureBuffer] = await Promise.all([
        loadAsset(logoUrl),
        loadAsset(signatureUrl)
      ]);

      const marginTop = 57;
      const marginSide = 51;
      const marginBottom = 51;
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
      const textColor = '#000000';
      const mutedColor = '#333333';
      const borderColor = '#d1d5db';

      const contentText = (text, options = {}) => {
        doc.text(text, marginSide, doc.y, {
          width: printableWidth,
          ...options
        });
      };

      const ensureSpace = (requiredHeight) => {
        if (doc.y + requiredHeight > doc.page.height - marginBottom - 18) {
          doc.addPage();
          doc.y = marginTop;
        }
      };

      const drawHeader = () => {
        doc.save();
        const logoSize = 42;
        const logoX = marginSide + 12;
        const logoY = marginTop + 12;
        const leftX = marginSide + logoSize + 36;
        const rightWidth = 170;
        const rightX = pageWidth - marginSide - rightWidth;
        const leftWidth = rightX - leftX - 18;
        const headerBottom = marginTop + 84;

        if (logoBuffer) {
          try {
            doc.image(logoBuffer, logoX, logoY, { width: logoSize, height: logoSize });
          } catch (error) {
            // Logo is optional.
          }
        }

        doc.fillColor(textColor)
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(legalName, leftX, marginTop + 6, {
            width: leftWidth,
            height: 13,
            lineBreak: false
          });

        doc.fillColor(mutedColor)
          .font('Helvetica')
          .fontSize(8)
          .text(`Nombre comercial: ${commercialName}`, leftX, marginTop + 20, {
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

        if (phone) {
          doc.text(`Tel: ${phone}`, leftX, marginTop + 64, {
            width: leftWidth,
            height: 10,
            lineBreak: false
          });
        }

        doc.fontSize(8)
          .text(`Codigo: ${requestCode}`, rightX, marginTop + 6, {
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
          })
          .text(`Tipo: ${config.prefix}`, rightX, marginTop + 30, {
            width: rightWidth,
            height: 10,
            align: 'right',
            lineBreak: false
          });

        doc.moveTo(marginSide, headerBottom)
          .lineTo(pageWidth - marginSide, headerBottom)
          .lineWidth(1)
          .strokeColor(textColor)
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

          doc.fillColor(mutedColor)
            .font('Helvetica-Oblique')
            .fontSize(7)
            .text('Documento generado por el Sistema de Gestion de RR.HH. - FABRYOR', marginSide, footerY, {
              width: printableWidth - 90,
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

      const paragraphOptions = { width: printableWidth, align: 'justify', lineGap: 3 };

      const addSectionTitle = (title) => {
        ensureSpace(28);
        doc.moveDown(0.35);
        doc.font('Helvetica-Bold').fontSize(10.8).fillColor(textColor);
        contentText(title, { width: printableWidth, lineGap: 1 });
        doc.moveDown(0.25);
      };

      const addParagraph = (text, options = {}) => {
        const content = String(text || '');
        doc.font('Helvetica').fontSize(10.2).fillColor(textColor);
        const height = doc.heightOfString(content, { ...paragraphOptions, ...options });
        ensureSpace(height + 8);
        contentText(content, { ...paragraphOptions, ...options });
        doc.moveDown(0.45);
      };

      const addInfoTable = (title, rows) => {
        const cleanRows = rows.filter(([, value]) => value !== undefined && value !== null);
        if (cleanRows.length === 0) return;

        addSectionTitle(title);
        const labelWidth = 168;
        const valueWidth = printableWidth - labelWidth;

        cleanRows.forEach(([label, value]) => {
          const valueText = valueOrFallback(value);
          const valueHeight = doc.heightOfString(String(valueText), {
            width: valueWidth - 12,
            lineGap: 1
          });
          const rowHeight = Math.max(19, valueHeight + 8);
          ensureSpace(rowHeight + 2);

          const y = doc.y;
          doc.rect(marginSide, y, labelWidth, rowHeight)
            .lineWidth(0.5)
            .strokeColor(borderColor)
            .stroke();
          doc.rect(marginSide + labelWidth, y, valueWidth, rowHeight)
            .lineWidth(0.5)
            .strokeColor(borderColor)
            .stroke();

          doc.font('Helvetica-Bold')
            .fontSize(8.6)
            .fillColor(textColor)
            .text(label, marginSide + 6, y + 5, {
              width: labelWidth - 12,
              height: rowHeight - 6
            });

          doc.font('Helvetica')
            .fontSize(8.6)
            .text(String(valueText), marginSide + labelWidth + 6, y + 5, {
              width: valueWidth - 12,
              height: rowHeight - 6
            });

          doc.y = y + rowHeight;
        });

        doc.moveDown(0.55);
      };

      const addBullets = (title, items) => {
        addSectionTitle(title);
        items.filter(Boolean).forEach((item) => {
          const text = `- ${item}`;
          doc.font('Helvetica').fontSize(9.8).fillColor(textColor);
          const height = doc.heightOfString(text, { width: printableWidth - 10, lineGap: 2 });
          ensureSpace(height + 5);
          doc.text(text, marginSide + 8, doc.y, { width: printableWidth - 10, lineGap: 2 });
          doc.moveDown(0.25);
        });
        doc.moveDown(0.25);
      };

      const addWorkerAndRequestSummary = () => {
        addInfoTable('Datos del trabajador', [
          ['Nombres y apellidos', workerName],
          [workerDocumentType, workerDocument],
          ['Cargo', positionName],
          ['Area', areaName],
          ['Sede u obra', workLocationName],
          ['Fecha de ingreso', hireDate],
          ['Codigo de trabajador', workerCode]
        ]);

        addInfoTable('Datos de la solicitud', [
          ['Codigo de solicitud', requestCode],
          ['Tipo de solicitud', requestTypeLabel],
          ['Estado', statusLabel],
          ['Fecha de creacion', request.created_at ? formatDateTime(request.created_at) : formatDateTime(generatedAt)],
          ['Responsable de revision', rrhhResponsible],
          ['Fecha de revision', reviewDate],
          ['Documento representa', config.represents]
        ]);
      };

      const renderMedicalLeave = () => {
        addParagraph(`En la ciudad de ${city}, con fecha ${formatDate(generatedAt)}, el/la trabajador(a) ${workerName}, identificado(a) con ${workerDocumentType} N. ${workerDocument}, quien labora en el cargo de ${positionName} en el area de ${areaName}, solicita a ${legalName} el registro de su descanso medico.`);
        addInfoTable('Periodo de descanso medico', [
          ['Fecha de inicio del descanso medico', startDate],
          ['Fecha de fin del descanso medico', endDate],
          ['Numero total de dias', totalDays],
          ['Centro medico o profesional tratante', firstValue(metadata, ['medicalCenter', 'medical_center', 'descanso_centro_medico', 'centroMedico'])],
          ['Numero de certificado medico/CITT', firstValue(metadata, ['certificateNumber', 'certificate_number', 'descanso_numero_certificado', 'numeroCertificado'])],
          ['Diagnostico o descripcion general', firstValue(metadata, ['diagnosisSummary', 'diagnosis_summary', 'descanso_descripcion_general', 'descripcionGeneral'])]
        ]);
        addParagraph('El/la trabajador(a) declara que la informacion registrada y los documentos adjuntos son veraces, y autoriza a la empresa a revisar la documentacion presentada para fines laborales y administrativos.');
        addParagraph('El presente documento no constituye aprobacion automatica del descanso medico, sino constancia de presentacion para revision por parte de RR.HH. La empresa podra solicitar documentacion adicional cuando sea necesario.');
        addBullets('Sustento obligatorio', [
          'Certificado medico, CITT o documento equivalente.',
          'Documento adicional solicitado por RR.HH., si corresponde.'
        ]);
      };

      const renderVacation = () => {
        addParagraph(`En la ciudad de ${city}, con fecha ${formatDate(generatedAt)}, el/la trabajador(a) ${workerName}, identificado(a) con ${workerDocumentType} N. ${workerDocument}, solicita a ${legalName} hacer uso de su descanso vacacional.`);
        addInfoTable('Periodo solicitado', [
          ['Fecha de inicio de vacaciones', startDate],
          ['Fecha de fin de vacaciones', endDate],
          ['Total de dias calendario solicitados', totalDays],
          ['Periodo laboral al que corresponden', firstValue(metadata, ['vacationPeriod', 'vacation_period', 'vacaciones_periodo_laboral', 'periodoLaboral'])],
          ['Dias disponibles antes de la solicitud', firstValue(metadata, ['vacationBalance.availableDaysBefore', 'vacationBalance.availableDays', 'vacaciones_dias_disponibles', 'diasDisponibles'])],
          ['Dias restantes despues de la solicitud', firstValue(metadata, ['vacationBalance.remainingDays', 'vacaciones_dias_restantes', 'diasRestantes'])]
        ]);
        addParagraph('El/la trabajador(a) declara conocer que el descanso vacacional se encuentra sujeto a la verificacion del record vacacional, la disponibilidad de dias acumulados, la programacion interna de la empresa y la aprobacion correspondiente.');
        addParagraph('La sola presentacion de esta solicitud no autoriza al trabajador a ausentarse de sus labores. El descanso vacacional sera valido unicamente cuando la solicitud sea aprobada por RR.HH. o por el jefe autorizado.');
        addInfoTable('Motivo o comentario del trabajador', [
          ['Detalle', reason]
        ]);
      };

      const renderPersonalPermission = () => {
        addParagraph(`En la ciudad de ${city}, con fecha ${formatDate(generatedAt)}, el/la trabajador(a) ${workerName}, identificado(a) con ${workerDocumentType} N. ${workerDocument}, solicita permiso personal para ausentarse de sus labores durante el periodo indicado.`);
        addInfoTable('Periodo del permiso', [
          ['Fecha del permiso', startDate],
          ['Fecha de fin, si aplica', endDate],
          ['Hora de inicio', timeOnly(request.start_time || metadata.startTime || metadata.permiso_hora_inicio)],
          ['Hora de fin', timeOnly(request.end_time || metadata.endTime || metadata.permiso_hora_fin)],
          ['Total de horas/dias solicitados', firstValue(metadata, ['permissionTotal', 'permission_total', 'permiso_total'], totalDays)],
          ['Tipo de permiso', firstValue(metadata, ['permissionType', 'permission_type', 'permiso_tipo'])],
          ['Modalidad', firstValue(metadata, ['permissionMode', 'permission_mode', 'modalidad', 'permiso_modalidad'])]
        ]);
        addInfoTable('Motivo de la solicitud', [
          ['Detalle', reason]
        ]);
        addParagraph('El/la trabajador(a) declara que conoce que la aprobacion del permiso esta sujeta a evaluacion de la empresa, necesidades operativas, politica interna y autorizacion del jefe inmediato o RR.HH.');
        addParagraph('La sola presentacion de esta solicitud no autoriza la ausencia. El permiso sera valido unicamente cuando sea aprobado por la empresa.');
      };

      const renderAbsenceJustification = () => {
        addParagraph(`En la ciudad de ${city}, con fecha ${formatDate(generatedAt)}, el/la trabajador(a) ${workerName}, identificado(a) con ${workerDocumentType} N. ${workerDocument}, solicita la evaluacion y justificacion de una inasistencia registrada en el sistema de asistencia.`);
        addInfoTable('Datos de la inasistencia', [
          ['Fecha de inasistencia', firstValue(metadata, ['absenceDate', 'absence_date', 'inasistencia_fecha'], startDate)],
          ['Turno programado', firstValue(metadata, ['shiftName', 'shift_name', 'turno_nombre'])],
          ['Hora de ingreso programada', firstValue(metadata, ['shiftStartTime', 'shift_start_time', 'turno_hora_inicio'])],
          ['Hora de salida programada', firstValue(metadata, ['shiftEndTime', 'shift_end_time', 'turno_hora_fin'])],
          ['Estado registrado por el sistema', firstValue(metadata, ['attendanceStatus', 'attendance_status', 'asistencia_estado'])],
          ['Motivo declarado por el trabajador', reason]
        ]);
        addParagraph('El/la trabajador(a) solicita que la empresa revise el caso y determine si corresponde justificar la inasistencia, modificar el estado de asistencia o mantener el registro original.');
        addParagraph('La presentacion de esta solicitud no elimina ni modifica automaticamente la falta registrada. Cualquier cambio quedara sujeto a la validacion de RR.HH. y a la documentacion presentada.');
        addBullets('Sustento adjunto sugerido', [
          'Certificado medico.',
          'Documento policial.',
          'Constancia institucional.',
          'Documento familiar u otro sustento validado por RR.HH.'
        ]);
      };

      const renderShiftChange = () => {
        addParagraph(`En la ciudad de ${city}, con fecha ${formatDate(generatedAt)}, el/la trabajador(a) ${workerName}, identificado(a) con ${workerDocumentType} N. ${workerDocument}, solicita la modificacion temporal o permanente de su horario o turno de trabajo.`);
        addInfoTable('Horario actual', [
          ['Turno actual', firstValue(metadata, ['currentShift.name', 'currentShiftName', 'turno_actual_nombre'])],
          ['Dias de trabajo actuales', firstValue(metadata, ['currentShift.days', 'currentShiftDays', 'turno_actual_dias'])],
          ['Hora de ingreso actual', firstValue(metadata, ['currentShift.startTime', 'currentShiftStartTime', 'turno_actual_inicio'])],
          ['Hora de salida actual', firstValue(metadata, ['currentShift.endTime', 'currentShiftEndTime', 'turno_actual_fin'])],
          ['Sede u obra actual', workLocationName]
        ]);
        addInfoTable('Horario solicitado', [
          ['Nuevo turno solicitado', firstValue(metadata, ['newShift.name', 'newShiftName', 'turno_nuevo_nombre'])],
          ['Dias solicitados', firstValue(metadata, ['newShift.days', 'newShiftDays', 'turno_nuevo_dias'])],
          ['Hora de ingreso solicitada', firstValue(metadata, ['newShift.startTime', 'newShiftStartTime', 'turno_nuevo_inicio'])],
          ['Hora de salida solicitada', firstValue(metadata, ['newShift.endTime', 'newShiftEndTime', 'turno_nuevo_fin'])],
          ['Fecha de inicio del cambio', startDate],
          ['Fecha de fin del cambio', endDate],
          ['Tipo de cambio', firstValue(metadata, ['changeType', 'change_type', 'tipo_cambio'])]
        ]);
        addInfoTable('Motivo de la solicitud', [
          ['Detalle', reason]
        ]);
        addParagraph('El/la trabajador(a) declara conocer que el cambio de horario esta sujeto a evaluacion de la empresa, disponibilidad operativa, jornada maxima legal, necesidades del servicio y aprobacion del area correspondiente.');
        addParagraph('La presentacion de esta solicitud no modifica automaticamente el horario asignado en el sistema. El cambio sera valido unicamente cuando sea aprobado y registrado por RR.HH. o por el responsable autorizado.');
      };

      const renderFamilyLeave = () => {
        addParagraph(`En la ciudad de ${city}, con fecha ${formatDate(generatedAt)}, el/la trabajador(a) ${workerName}, identificado(a) con ${workerDocumentType} N. ${workerDocument}, solicita licencia laboral para asistir a un familiar directo que se encuentra en situacion de enfermedad grave, enfermedad terminal o accidente grave.`);
        addInfoTable('Datos del familiar', [
          ['Nombre completo del familiar', firstValue(metadata, ['familyMember.fullName', 'familyFullName', 'familiar_nombre_completo'])],
          ['Tipo de vinculo', firstValue(metadata, ['familyMember.relationship', 'familyRelationship', 'familiar_vinculo'])],
          ['DNI/CE del familiar', firstValue(metadata, ['familyMember.documentNumber', 'familyDocumentNumber', 'familiar_documento'])],
          ['Situacion medica', firstValue(metadata, ['medicalSituation', 'medical_situation', 'situacion_medica'])]
        ]);
        addInfoTable('Periodo solicitado', [
          ['Fecha de inicio', startDate],
          ['Fecha de fin', endDate],
          ['Total de dias solicitados', totalDays],
          ['Motivo o detalle', reason]
        ]);
        addParagraph('El/la trabajador(a) declara que la informacion registrada es veraz y que adjunta la documentacion necesaria para acreditar el vinculo familiar y la situacion medica declarada.');
        addParagraph('La solicitud sera evaluada por RR.HH. conforme a la normativa aplicable y a la documentacion presentada.');
        addBullets('Sustento obligatorio', [
          'Documento que acredite vinculo familiar.',
          'Certificado medico, informe medico o documento equivalente que sustente la situacion declarada.',
          'Otros documentos solicitados por RR.HH., si corresponde.'
        ]);
      };

      const renderGeneralRequest = () => {
        addParagraph(`En la ciudad de ${city}, con fecha ${formatDate(generatedAt)}, el/la trabajador(a) ${workerName}, identificado(a) con ${workerDocumentType} N. ${workerDocument}, presenta a ${legalName} la solicitud laboral indicada para revision de RR.HH.`);
        addInfoTable('Detalle de la solicitud', [
          ['Tipo de solicitud', requestTypeLabel],
          ['Fecha de inicio', startDate],
          ['Fecha de fin', endDate],
          ['Total de dias solicitados', totalDays],
          ['Motivo o comentario', reason],
          ['Requiere sustento', formatBoolean(config.supportRequired)]
        ]);
        addParagraph('El presente documento constituye constancia de presentacion de una solicitud laboral y no implica aprobacion automatica. La empresa podra solicitar documentacion adicional cuando sea necesario.');
      };

      const renderRequestSpecificContent = () => {
        if (config.key === 'MEDICAL_LEAVE') return renderMedicalLeave();
        if (config.key === 'VACATION') return renderVacation();
        if (config.key === 'PERSONAL_PERMISSION') return renderPersonalPermission();
        if (config.key === 'ABSENCE_JUSTIFICATION') return renderAbsenceJustification();
        if (config.key === 'SHIFT_CHANGE') return renderShiftChange();
        if (config.key === 'FAMILY_SERIOUS_ILLNESS_LEAVE') return renderFamilyLeave();
        return renderGeneralRequest();
      };

      const addDeclarationsAndReview = () => {
        addSectionTitle('Declaracion del trabajador');
        addParagraph('Declaro bajo responsabilidad que la informacion registrada y los documentos presentados son autenticos, completos y corresponden al periodo informado.');

        addInfoTable('Recepcion y evaluacion de la empresa', [
          ['Recibido por', rrhhResponsible],
          ['Cargo', legalRepRole],
          ['Fecha de recepcion o revision', reviewDate],
          ['Resultado actual', statusLabel],
          ['Observaciones', rrhhObservations]
        ]);

        addBullets('Advertencias generales', [
          'El presente documento constituye una solicitud del trabajador y no implica aprobacion automatica, salvo que la normativa aplicable o la politica interna disponga lo contrario.',
          'La empresa podra solicitar documentacion adicional para validar la solicitud presentada.',
          'La informacion falsa, incompleta o adulterada podra generar el rechazo de la solicitud y las acciones internas que correspondan.',
          'Toda modificacion en asistencia, remuneracion, vacaciones, permisos o licencias sera registrada en el sistema con trazabilidad y auditoria.'
        ]);
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
        const companyX = marginSide;
        const workerX = marginSide + colHalf;
        const lineInset = 10;
        const boxWidth = colHalf - 22;
        const textTop = sigY + 9;

        doc.save();
        if (signatureBuffer) {
          try {
            doc.image(signatureBuffer, companyX + (boxWidth - 90) / 2 + lineInset, sigY - 43, { width: 90, height: 30 });
          } catch (error) {
            // Signature image is optional.
          }
        }

        doc.moveTo(companyX + lineInset, sigY)
          .lineTo(companyX + boxWidth, sigY)
          .strokeColor(textColor)
          .lineWidth(0.8)
          .stroke();
        doc.fillColor(textColor)
          .font('Helvetica-Bold')
          .fontSize(8.2)
          .text('RECIBIDO POR LA EMPRESA', companyX + lineInset, textTop, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica-Bold')
          .fontSize(7)
          .text(legalName, companyX + lineInset, textTop + 14, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica')
          .fontSize(7)
          .text(`RUC: ${ruc}`, companyX + lineInset, textTop + 26, { width: boxWidth - lineInset, align: 'center' });
        doc.text(rrhhResponsible, companyX + lineInset, textTop + 40, { width: boxWidth - lineInset, align: 'center' });
        doc.text(legalRepRole, companyX + lineInset, textTop + 51, { width: boxWidth - lineInset, align: 'center' });

        doc.moveTo(workerX + lineInset, sigY)
          .lineTo(workerX + boxWidth, sigY)
          .strokeColor(textColor)
          .lineWidth(0.8)
          .stroke();
        doc.fillColor(textColor)
          .font('Helvetica-Bold')
          .fontSize(8.2)
          .text('EL TRABAJADOR', workerX + lineInset, textTop, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica-Bold')
          .fontSize(7)
          .text(workerName, workerX + lineInset, textTop + 14, { width: boxWidth - lineInset, align: 'center' });
        doc.font('Helvetica')
          .fontSize(7)
          .text(`${workerDocumentType}: ${workerDocument}`, workerX + lineInset, textTop + 38, { width: boxWidth - lineInset, align: 'center' });

        const fingerprintX = pageWidth - marginSide - fingerprintWidth;
        doc.rect(fingerprintX, sigY - 12, fingerprintWidth, 58)
          .lineWidth(0.5)
          .strokeColor(textColor)
          .stroke();
        doc.fillColor(textColor)
          .font('Helvetica')
          .fontSize(5.7)
          .text('Huella digital', fingerprintX + 3, sigY + 12, { width: fingerprintWidth - 6, align: 'center' });
        doc.restore();
      };

      drawHeader();
      doc.fillColor(textColor)
        .font('Helvetica-Bold')
        .fontSize(15)
        .text(config.title, marginSide, doc.y, { width: printableWidth, align: 'center' });
      doc.moveDown(1);

      addWorkerAndRequestSummary();
      renderRequestSpecificContent();
      addDeclarationsAndReview();
      drawSignaturesAtBottom();
      drawFooter();
      doc.end();
    } catch (err) {
      logger.logError('REQUEST_DOCUMENT_PDF', 'Failed to generate request document PDF', err);
      reject(err);
    }
  });
}

module.exports = {
  generateRequestDocumentPdf
};
