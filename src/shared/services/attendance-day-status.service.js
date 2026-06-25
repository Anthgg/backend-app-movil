const { query } = require('../../config/database');

const REQUEST_DAY_STATES = Object.freeze({
  VACATION: Object.freeze({
    requestType: 'VACATION',
    attendanceStatus: 'vacation',
    displayStatus: 'Vacaciones',
    message: 'Estás de vacaciones',
    isPaid: true,
    perceivesPay: true,
    paymentStatus: 'paid',
    priority: 1
  }),
  MEDICAL_LEAVE: Object.freeze({
    requestType: 'MEDICAL_LEAVE',
    attendanceStatus: 'medical_leave',
    displayStatus: 'Descanso médico',
    message: 'Estás con descanso médico',
    isPaid: true,
    perceivesPay: true,
    paymentStatus: 'paid',
    priority: 2
  }),
  UNPAID_LEAVE: Object.freeze({
    requestType: 'UNPAID_LEAVE',
    attendanceStatus: 'unpaid_leave',
    displayStatus: 'Permiso personal',
    message: 'Tienes permiso personal aprobado',
    isPaid: false,
    perceivesPay: false,
    paymentStatus: 'unpaid',
    priority: 3
  })
});

const TYPE_ALIASES = new Map([
  ['VACATION', 'VACATION'],
  ['VAC', 'VACATION'],
  ['VACACIONES', 'VACATION'],
  ['MEDICAL_LEAVE', 'MEDICAL_LEAVE'],
  ['MEDICAL', 'MEDICAL_LEAVE'],
  ['DESCANSO_MEDICO', 'MEDICAL_LEAVE'],
  ['DESCANSO MEDICO', 'MEDICAL_LEAVE'],
  ['DESCANSO', 'MEDICAL_LEAVE'],
  ['DM', 'MEDICAL_LEAVE'],
  ['CERTIFICADO_MEDICO', 'MEDICAL_LEAVE'],
  ['CERTIFICADO MEDICO', 'MEDICAL_LEAVE'],
  ['LICENCIA_MEDICA', 'MEDICAL_LEAVE'],
  ['LICENCIA MEDICA', 'MEDICAL_LEAVE'],
  ['UNPAID_LEAVE', 'UNPAID_LEAVE'],
  ['PERSONAL_PERMISSION', 'UNPAID_LEAVE'],
  ['PERMISO_PERSONAL', 'UNPAID_LEAVE'],
  ['PERMISO PERSONAL', 'UNPAID_LEAVE'],
  ['PERMISO', 'UNPAID_LEAVE'],
  ['PERM', 'UNPAID_LEAVE'],
  ['LEAVE_PERMISSION', 'UNPAID_LEAVE']
]);

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-\s]+/g, '_')
    .toUpperCase();
}

function normalizeRequestType(code, name) {
  for (const value of [code, name]) {
    const token = normalizeToken(value);
    if (TYPE_ALIASES.has(token)) {
      return TYPE_ALIASES.get(token);
    }
  }
  return null;
}

function formatDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function resolveRequestPayMetadata(canonicalType, row = {}) {
  const state = REQUEST_DAY_STATES[canonicalType] || {};
  const isPaid = canonicalType === 'UNPAID_LEAVE'
    ? false
    : (row.is_paid === undefined || row.is_paid === null ? state.isPaid !== false : row.is_paid === true);
  const affectsPayroll = row.affects_payroll === undefined || row.affects_payroll === null
    ? true
    : row.affects_payroll === true;
  const paymentStatus = isPaid ? 'paid' : 'unpaid';

  return {
    isPaid,
    is_paid: isPaid,
    perceivesPay: isPaid,
    perceives_pay: isPaid,
    paid: isPaid,
    paymentStatus,
    payment_status: paymentStatus,
    payrollStatus: paymentStatus,
    payroll_status: paymentStatus,
    affectsPayroll,
    affects_payroll: affectsPayroll,
    payrollAffects: affectsPayroll,
    payroll_affects: affectsPayroll
  };
}

function serializeBlock(row) {
  const canonicalType = normalizeRequestType(row.type_code, row.type_name);
  const state = REQUEST_DAY_STATES[canonicalType];
  if (!state) return null;
  const payMetadata = resolveRequestPayMetadata(canonicalType, row);

  return {
    ...state,
    ...payMetadata,
    requestId: row.id,
    request_id: row.id,
    startDate: formatDate(row.start_date),
    start_date: formatDate(row.start_date),
    endDate: formatDate(row.end_date),
    end_date: formatDate(row.end_date),
    reason: row.reason || null
  };
}

async function listApprovedAttendanceBlocks(workerId, companyId, startDate, endDate, db = { query }) {
  if (!workerId || !companyId || !startDate || !endDate) return [];

  const result = await db.query(`
    SELECT r.id,
           r.start_date,
           r.end_date,
           r.reason,
           rt.code AS type_code,
           rt.name AS type_name,
           rt.is_paid,
           rt.affects_payroll
    FROM employee_requests r
    JOIN request_types rt ON rt.id = r.request_type_id
    WHERE r.worker_id = $1
      AND r.company_id = $2
      AND LOWER(r.status) = 'approved'
      AND r.start_date <= $4::date
      AND r.end_date >= $3::date
      AND COALESCE(rt.affects_attendance, TRUE) = TRUE
      AND COALESCE(rt.is_active, TRUE) = TRUE
    ORDER BY r.start_date ASC, r.created_at ASC
  `, [workerId, companyId, startDate, endDate]);

  return result.rows
    .map(serializeBlock)
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority);
}

async function getApprovedAttendanceBlock(workerId, companyId, date, db = { query }) {
  const blocks = await listApprovedAttendanceBlocks(workerId, companyId, date, date, db);
  return blocks[0] || null;
}

function expandApprovedAttendanceBlocks(blocks, rangeStart, rangeEnd) {
  const startBoundary = new Date(`${formatDate(rangeStart)}T00:00:00.000Z`);
  const endBoundary = new Date(`${formatDate(rangeEnd)}T00:00:00.000Z`);
  const days = [];

  for (const block of blocks || []) {
    const start = new Date(`${block.startDate}T00:00:00.000Z`);
    const end = new Date(`${block.endDate}T00:00:00.000Z`);
    const cursor = new Date(Math.max(start.getTime(), startBoundary.getTime()));
    const last = new Date(Math.min(end.getTime(), endBoundary.getTime()));

    while (cursor <= last) {
      days.push({ ...block, date: cursor.toISOString().slice(0, 10) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const byDate = new Map();
  for (const day of days.sort((left, right) => left.priority - right.priority)) {
    if (!byDate.has(day.date)) byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function getApprovedAttendanceDays(workerId, companyId, startDate, endDate, db = { query }) {
  const blocks = await listApprovedAttendanceBlocks(workerId, companyId, startDate, endDate, db);
  return expandApprovedAttendanceBlocks(blocks, startDate, endDate);
}

async function getApprovedAttendanceDayCounts(workerId, companyId, startDate, endDate, db = { query }) {
  const days = await getApprovedAttendanceDays(workerId, companyId, startDate, endDate, db);
  return days.reduce((counts, day) => {
    counts[day.requestType] = (counts[day.requestType] || 0) + 1;
    return counts;
  }, { VACATION: 0, MEDICAL_LEAVE: 0, UNPAID_LEAVE: 0 });
}

function buildBlockedAttendanceError(block) {
  const error = new Error(`No puedes marcar asistencia por una solicitud aprobada: ${block.displayStatus}.`);
  error.statusCode = 403;
  error.errorCode = 'ATTENDANCE_BLOCKED_BY_APPROVED_REQUEST';
  error.details = {
    requestId: block.requestId,
    requestType: block.requestType,
    attendanceStatus: block.attendanceStatus,
    startDate: block.startDate,
    endDate: block.endDate
  };
  return error;
}

async function assertAttendanceNotBlocked(workerId, companyId, date, db = { query }) {
  const block = await getApprovedAttendanceBlock(workerId, companyId, date, db);
  if (block) throw buildBlockedAttendanceError(block);
  return null;
}

module.exports = {
  REQUEST_DAY_STATES,
  normalizeRequestType,
  resolveRequestPayMetadata,
  serializeBlock,
  listApprovedAttendanceBlocks,
  getApprovedAttendanceBlock,
  expandApprovedAttendanceBlocks,
  getApprovedAttendanceDays,
  getApprovedAttendanceDayCounts,
  buildBlockedAttendanceError,
  assertAttendanceNotBlocked
};
