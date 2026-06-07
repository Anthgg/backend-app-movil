const { query } = require('../../../config/database');
const { createHttpError } = require('../../../shared/utils/http-error');
const { isValidUUID } = require('../../../utils/uuid.util');
const { getTableColumns } = require('../../../utils/db.util');
const { generateCorporatePdf } = require('../../pdf/pdf-generator.service');
const moment = require('moment');
const { Readable } = require('stream');

const REPORT_ERROR_CODES = {
  INVALID_WORKER_ID: 'INVALID_WORKER_ID',
  WORKER_NOT_FOUND: 'WORKER_NOT_FOUND',
  REPORT_FORBIDDEN: 'REPORT_FORBIDDEN',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  LOCATION_HISTORY_REPORT_FAILED: 'LOCATION_HISTORY_REPORT_FAILED'
};

const MOVEMENT_TYPE_LABELS = {
  permanent_assignment_created: 'Asignacion permanente',
  temporary_assignment_created: 'Asignacion temporal',
  worker_added_to_crew: 'Ingreso a cuadrilla',
  worker_moved_crew: 'Cambio de cuadrilla',
  worker_removed_from_crew: 'Retiro de cuadrilla',
  worker_reassigned: 'Reasignacion',
  work_location_changed: 'Cambio de obra',
  crew_work_location_changed: 'Cambio de obra de cuadrilla',
  crew_changed: 'Cambio de cuadrilla',
  reassignment_created: 'Reasignacion',
  location_assignment_created: 'Asignacion de lugar de trabajo',
  individual_location_assignment_cancelled: 'Cancelacion de asignacion'
};

const ALLOWED_REPORT_PERMISSIONS = new Set([
  'workers.read',
  'workers.manage',
  'reports.read',
  'reports.workers',
  'reports.workers.read',
  'reports.workers.export',
  'admin'
]);

const COMPANY_SETTING_FIELDS = [
  'razon_social',
  'nombre_comercial',
  'ruc',
  'direccion_fiscal',
  'telefono',
  'correo_corporativo',
  'pagina_web',
  'logo_url',
  'firma_url',
  'sello_url',
  'representante_legal',
  'cargo_representante',
  'color_primario',
  'color_secundario',
  'color_texto'
];

function getDb(dbClient = null) {
  return dbClient || { query };
}

function formatMovementType(type) {
  return MOVEMENT_TYPE_LABELS[type] || 'Movimiento registrado';
}

function normalizePermissions(user = {}) {
  return (user.permissions || []).map((permission) => String(permission).trim().toLowerCase()).filter(Boolean);
}

function normalizeRoles(user = {}) {
  return (user.roles || []).map((role) => String(role).trim().toUpperCase()).filter(Boolean);
}

function assertCanReadWorkerReport(user = {}) {
  const roles = normalizeRoles(user);
  if (roles.includes('ADMIN') || roles.includes('SUPER_ADMIN')) return;

  const permissions = normalizePermissions(user);
  if (permissions.some((permission) => ALLOWED_REPORT_PERMISSIONS.has(permission))) return;

  throw createHttpError(
    403,
    REPORT_ERROR_CODES.REPORT_FORBIDDEN,
    'No tienes permisos para descargar este reporte.'
  );
}

function validateWorkerId(workerId) {
  if (!isValidUUID(workerId)) {
    throw createHttpError(
      400,
      REPORT_ERROR_CODES.INVALID_WORKER_ID,
      'workerId invalido. Debe ser un UUID valido.'
    );
  }
}

function isValidDateString(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = moment(value, 'YYYY-MM-DD', true);
  return parsed.isValid();
}

function validateDateRange(startDate, endDate) {
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    throw createHttpError(
      400,
      REPORT_ERROR_CODES.INVALID_DATE_RANGE,
      'El rango de fechas no es valido. Usa el formato YYYY-MM-DD.'
    );
  }

  if (startDate && endDate && moment(startDate, 'YYYY-MM-DD').isAfter(moment(endDate, 'YYYY-MM-DD'))) {
    throw createHttpError(
      400,
      REPORT_ERROR_CODES.INVALID_DATE_RANGE,
      'La fecha inicial no puede ser mayor que la fecha final.'
    );
  }
}

function sanitizeFilenamePart(value, fallback = 'sin_documento') {
  const sanitized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || fallback;
}

function buildLocationHistoryFilename(worker) {
  const documentPart = sanitizeFilenamePart(worker.document_number || worker.personal_id);
  const workerPart = sanitizeFilenamePart(worker.worker_id || worker.id, 'worker');
  return `historial_movimientos_${documentPart}_${workerPart}.pdf`;
}

function displayValue(value, fallback = 'No especificado') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = moment(value);
  return parsed.isValid() ? parsed.format('DD/MM/YYYY HH:mm') : String(value);
}

function formatDate(value) {
  if (!value) return null;
  const parsed = moment(value, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed.format('DD/MM/YYYY') : null;
}

function formatStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    active: 'Activo',
    inactive: 'Inactivo',
    assigned: 'Asignado',
    busy: 'Ocupado',
    permanent: 'Permanente',
    temporary: 'Temporal',
    transferred: 'Transferido',
    terminated: 'Cesado',
    completed: 'Completado',
    cancelled: 'Cancelado'
  };
  return map[normalized] || displayValue(status, 'No especificado');
}

function formatMovementStatus(movement = {}) {
  const status = movement.status || movement.assignment_type;
  return status ? formatStatus(status) : 'Registrado';
}

function buildMovementDetails(row = {}) {
  const parts = [];
  if (row.previous_work_location_name || row.new_work_location_name) {
    if (row.previous_work_location_name && row.new_work_location_name) {
      parts.push(`${row.previous_work_location_name} -> ${row.new_work_location_name}`);
    } else {
      parts.push(`Destino: ${row.new_work_location_name || row.previous_work_location_name}`);
    }
  }

  if (row.previous_crew_name || row.new_crew_name) {
    if (row.previous_crew_name && row.new_crew_name) {
      parts.push(`${row.previous_crew_name} -> ${row.new_crew_name}`);
    } else {
      parts.push(`Cuadrilla: ${row.new_crew_name || row.previous_crew_name}`);
    }
  }

  return parts.length > 0 ? parts.join(' / ') : 'Sin detalle registrado';
}

function getCompanyConfig(worker = {}) {
  return {
    legalName: worker.razon_social || worker.company_name || 'FABRYOR SERVICIOS GENERALES S.A.C.',
    commercialName: worker.nombre_comercial || worker.company_name || 'FABRYOR',
    ruc: worker.ruc || 'No configurado',
    fiscalAddress: worker.direccion_fiscal || 'No configurado',
    email: worker.correo_corporativo || null,
    phone: worker.telefono || null,
    website: worker.pagina_web || null,
    logoUrl: worker.logo_url || null,
    signatureUrl: worker.firma_url || null,
    stampUrl: worker.sello_url || null,
    legalRepresentativeName: worker.representante_legal || null,
    legalRepresentativeRole: worker.cargo_representante || null,
    primaryColor: worker.color_primario || '#1e3a8a',
    secondaryColor: worker.color_secundario || '#3b82f6',
    textColor: worker.color_texto || '#0f172a'
  };
}

function getGeneratedBy(user = {}) {
  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return fullName || user.name || user.email || 'Sistema';
}

function buildReportPeriodLabel(startDate, endDate) {
  if (!startDate && !endDate) return 'Todo el historial disponible';
  return `${formatDate(startDate) || 'Inicio'} al ${formatDate(endDate) || 'Fin'}`;
}

function buildWorkerLocationHistoryRows(movements = []) {
  if (!movements.length) {
    return [{
      movement_date: '-',
      movement_type: 'Sin movimientos',
      detail: 'No se encontraron movimientos registrados para el periodo seleccionado.',
      reason: '-',
      status: '-',
      changed_by_name: '-'
    }];
  }

  return movements.map((movement) => ({
    movement_date: formatDateTime(movement.changed_at),
    movement_type: formatMovementType(movement.change_type),
    detail: buildMovementDetails(movement),
    reason: movement.reason || 'No especificado',
    status: formatMovementStatus(movement),
    changed_by_name: movement.changed_by_name || 'Sistema'
  }));
}

function buildWorkerLocationHistoryCorporatePayload({
  worker,
  movements,
  startDate,
  endDate,
  currentUser,
  generatedAt = new Date()
}) {
  const rows = buildWorkerLocationHistoryRows(movements);
  const period = buildReportPeriodLabel(startDate, endDate);
  const generatedBy = getGeneratedBy(currentUser);

  return {
    companyConfig: getCompanyConfig(worker),
    reportTitle: 'HISTORIAL DE MOVIMIENTOS Y ASIGNACIONES',
    documentType: 'Documento interno',
    internalLabel: 'F-RRHH-10',
    filters: {
      periodo: period
    },
    infoSections: [
      {
        title: 'INFORMACION DEL REPORTE',
        labelWidth: 86,
        rows: [
          { label: 'Tipo de documento', value: 'Documento interno' },
          { label: 'Codigo interno', value: 'F-RRHH-10' },
          { label: 'Fecha de generacion', value: formatDateTime(generatedAt) },
          { label: 'Generado por', value: generatedBy },
          { label: 'Periodo consultado', value: period },
          { label: 'Total movimientos', value: movements.length }
        ]
      },
      {
        title: 'DATOS DEL TRABAJADOR',
        labelWidth: 54,
        rows: [
          { label: 'Trabajador', value: worker.full_name },
          { label: 'DNI', value: worker.document_number || worker.personal_id }
        ]
      }
    ],
    infoSectionsLayout: 'combined-two-column',
    columns: [
      { key: 'movement_date', label: 'Fecha', widthRatio: 0.14 },
      { key: 'movement_type', label: 'Tipo de movimiento', widthRatio: 0.20 },
      { key: 'detail', label: 'Detalle', widthRatio: 0.24 },
      { key: 'reason', label: 'Motivo', widthRatio: 0.18 },
      { key: 'status', label: 'Estado', widthRatio: 0.10 },
      { key: 'changed_by_name', label: 'Autorizado por', widthRatio: 0.14 }
    ],
    rows,
    summary: null,
    showSummaryCards: false,
    signatureMode: 'fixed',
    generatedBy,
    generatedAt
  };
}

async function buildCompanySettingsSql(db) {
  let columns;
  try {
    columns = await getTableColumns('company_settings', db);
  } catch {
    columns = new Set();
  }

  const canJoinCompanySettings = columns.has('company_id');
  const selects = COMPANY_SETTING_FIELDS
    .map((field) => `${canJoinCompanySettings && columns.has(field) ? `cs.${field}` : 'NULL'} AS ${field}`)
    .join(',\n       ');
  const join = canJoinCompanySettings
    ? 'LEFT JOIN company_settings cs ON cs.company_id = w.company_id'
    : '';

  return { selects, join };
}

async function findWorkerForLocationHistoryReport({ workerId, companyId, dbClient = null }) {
  const db = getDb(dbClient);
  const companySettingsSql = await buildCompanySettingsSql(db);
  const result = await db.query(
    `SELECT
       w.id AS worker_id,
       COALESCE(
         NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name)), ''),
         NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
         u.email,
         'Sin nombre'
       ) AS full_name,
       COALESCE(w.document_number, w.personal_id) AS document_number,
       w.personal_id,
       jp.name AS position_name,
       a.name AS area_name,
       d.name AS internal_department_name,
       c.name AS company_name,
       ${companySettingsSql.selects},
       wl.name AS current_work_location_name,
       current_crew.name AS current_crew_name,
       COALESCE(w.employment_status, w.status, 'active') AS status
     FROM workers w
     LEFT JOIN users u ON u.id = w.user_id
     LEFT JOIN job_positions jp ON jp.id = COALESCE(w.position_id, w.job_position_id)
     LEFT JOIN areas a ON a.id = w.area_id
     LEFT JOIN departments d ON d.id = w.internal_department_id
     LEFT JOIN companies c ON c.id = w.company_id
     ${companySettingsSql.join}
     LEFT JOIN work_locations wl ON wl.id = w.work_location_id
     LEFT JOIN LATERAL (
       SELECT wc.name
       FROM crew_workers cw
       JOIN work_crews wc ON wc.id = cw.crew_id
       WHERE cw.worker_id = w.id
         AND cw.company_id = w.company_id
         AND cw.is_active = TRUE
         AND cw.unassigned_at IS NULL
         AND wc.deleted_at IS NULL
         AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
       ORDER BY cw.assigned_at DESC NULLS LAST, cw.created_at DESC NULLS LAST
       LIMIT 1
     ) current_crew ON TRUE
     WHERE w.id = $1
       AND w.company_id = $2
       AND w.deleted_at IS NULL
     LIMIT 1`,
    [workerId, companyId]
  );

  return result.rows[0] || null;
}

async function findWorkerLocationHistoryForReport({
  workerId,
  companyId,
  startDate = null,
  endDate = null,
  dbClient = null
}) {
  const db = getDb(dbClient);
  const result = await db.query(
    `SELECT
       wah.id,
       wah.worker_id,
       wah.changed_at,
       wah.changed_at AS effective_date,
       wah.change_type,
       prev_wl.name AS previous_work_location_name,
       new_wl.name AS new_work_location_name,
       prev_wc.name AS previous_crew_name,
       new_wc.name AS new_crew_name,
       wah.reason,
       wah.assignment_type AS status,
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'Sistema') AS changed_by_name
     FROM worker_assignment_history wah
     LEFT JOIN work_locations prev_wl ON prev_wl.id = wah.previous_work_location_id
     LEFT JOIN work_locations new_wl ON new_wl.id = wah.new_work_location_id
     LEFT JOIN work_crews prev_wc ON prev_wc.id = wah.previous_crew_id
     LEFT JOIN work_crews new_wc ON new_wc.id = wah.new_crew_id
     LEFT JOIN users u ON u.id = wah.changed_by
     WHERE wah.worker_id = $1
       AND wah.company_id = $2
       AND ($3::date IS NULL OR wah.changed_at::date >= $3::date)
       AND ($4::date IS NULL OR wah.changed_at::date <= $4::date)
     ORDER BY wah.changed_at DESC`,
    [workerId, companyId, startDate || null, endDate || null]
  );

  return result.rows;
}

async function createWorkerLocationHistoryPdf({
  worker,
  movements,
  startDate,
  endDate,
  currentUser,
  generatedAt = new Date()
}) {
  const payload = buildWorkerLocationHistoryCorporatePayload({
    worker,
    movements,
    startDate,
    endDate,
    currentUser,
    generatedAt
  });

  return generateCorporatePdf(payload);
}

async function generateWorkerLocationHistoryPdf({
  workerId,
  startDate = null,
  endDate = null,
  currentUser,
  companyId,
  dbClient = null,
  generatedAt = new Date()
}) {
  validateWorkerId(workerId);
  validateDateRange(startDate, endDate);
  assertCanReadWorkerReport(currentUser);

  const resolvedCompanyId = companyId || currentUser?.company_id;
  const worker = await findWorkerForLocationHistoryReport({ workerId, companyId: resolvedCompanyId, dbClient });
  if (!worker) {
    throw createHttpError(
      404,
      REPORT_ERROR_CODES.WORKER_NOT_FOUND,
      'No se encontro el trabajador solicitado.'
    );
  }

  const movements = await findWorkerLocationHistoryForReport({
    workerId,
    companyId: resolvedCompanyId,
    startDate,
    endDate,
    dbClient
  });

  const buffer = await createWorkerLocationHistoryPdf({
    worker,
    movements,
    startDate,
    endDate,
    currentUser,
    generatedAt
  });

  return {
    filename: buildLocationHistoryFilename(worker),
    buffer,
    stream: Readable.from([buffer])
  };
}

module.exports = {
  REPORT_ERROR_CODES,
  MOVEMENT_TYPE_LABELS,
  formatMovementType,
  validateWorkerId,
  validateDateRange,
  assertCanReadWorkerReport,
  buildMovementDetails,
  buildLocationHistoryFilename,
  buildWorkerLocationHistoryCorporatePayload,
  findWorkerForLocationHistoryReport,
  findWorkerLocationHistoryForReport,
  createWorkerLocationHistoryPdf,
  generateWorkerLocationHistoryPdf
};
