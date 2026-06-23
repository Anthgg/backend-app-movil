const path = require('path');
const crypto = require('crypto');
const { query } = require('../../config/database');
const env = require('../../config/env');
const { uploadFile } = require('../../shared/utils/storage.utils');

const BUCKET_NAME = env.workerDocumentsBucket || env.requestDocumentsBucket;

const FINAL_DOCUMENT_STATUSES = new Set(['approved', 'generated', 'signed']);
const REPLACEABLE_DOCUMENT_STATUSES = new Set(['missing', 'pending', 'observed', 'rejected', 'uploaded', 'active']);
const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected', 'observed', 'expired']);

function createHttpError(statusCode, errorCode, message, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (details) {
    error.details = details;
  }
  return error;
}

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizeDocumentType(value) {
  const normalized = String(value || 'OTHER')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .toUpperCase();

  return normalized || 'OTHER';
}

function normalizeStatus(value, fallback = 'pending') {
  return String(value || fallback).trim().toLowerCase();
}

function parseBoolean(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function toTitle(value) {
  const text = String(value || 'Documento').replace(/[_\-]+/g, ' ').trim();
  if (!text) {
    return 'Documento';
  }

  return text
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function sanitizeFileName(value) {
  const original = String(value || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return original || 'documento';
}

function getFileExtension(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (ext) return ext;
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime.includes('wordprocessingml')) return '.docx';
  if (mime.includes('spreadsheetml')) return '.xlsx';
  return '';
}

function buildStoragePath({ companyId, workerId, file }) {
  const now = new Date();
  const folder = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const ext = getFileExtension(file);
  const baseName = sanitizeFileName(path.basename(file?.originalname || 'documento', ext));
  const fileName = `${crypto.randomUUID()}-${baseName}${ext}`;
  return {
    fileName: sanitizeFileName(file?.originalname || `${baseName}${ext}`),
    filePath: `${companyId}/workers/${workerId}/${folder}/${fileName}`
  };
}

function canWorkerDeleteStatus(status) {
  return !FINAL_DOCUMENT_STATUSES.has(normalizeStatus(status));
}

function canReplaceStatus(status) {
  return REPLACEABLE_DOCUMENT_STATUSES.has(normalizeStatus(status));
}

function serializeDocument(row = {}) {
  const status = normalizeStatus(row.status);
  const type = row.document_type || row.type || 'OTHER';
  const title = row.title || row.file_name || toTitle(type);
  const uploadedAt = row.uploaded_at || row.created_at || null;
  const updatedAt = row.updated_at || uploadedAt;
  const sizeBytes = row.size_bytes === null || row.size_bytes === undefined
    ? null
    : Number(row.size_bytes);

  const workerName = row.worker_name || null;
  const uploadedByName = row.uploaded_by_name || null;
  const reviewedByName = row.reviewed_by_name || null;

  return {
    id: row.id,

    workerId: row.worker_id || row.workerId || null,
    worker_id: row.worker_id || row.workerId || null,
    workerName,
    worker_name: workerName,
    workerEmail: row.worker_email || null,
    worker_email: row.worker_email || null,

    type,
    documentType: type,
    document_type: type,
    typeLabel: row.type_label || toTitle(type),
    type_label: row.type_label || toTitle(type),
    title,
    name: title,
    description: row.description || null,

    status,
    fileName: row.file_name || null,
    file_name: row.file_name || null,
    mimeType: row.mime_type || null,
    mime_type: row.mime_type || null,
    sizeBytes,
    size_bytes: sizeBytes,
    size: sizeBytes,
    fileUrl: row.file_url || null,
    file_url: row.file_url || null,
    url: row.file_url || null,
    filePath: row.file_path || null,
    file_path: row.file_path || null,

    isRequired: row.is_required === true,
    is_required: row.is_required === true,
    dueDate: row.due_date || null,
    due_date: row.due_date || null,

    uploadedBy: row.uploaded_by || null,
    uploaded_by: row.uploaded_by || null,
    uploadedByName,
    uploaded_by_name: uploadedByName,
    uploadedAt,
    uploaded_at: uploadedAt,
    createdAt: uploadedAt,
    created_at: uploadedAt,

    reviewedBy: row.reviewed_by || null,
    reviewed_by: row.reviewed_by || null,
    reviewedByName,
    reviewed_by_name: reviewedByName,
    reviewedAt: row.reviewed_at || null,
    reviewed_at: row.reviewed_at || null,
    reviewComment: row.review_comment || null,
    review_comment: row.review_comment || null,

    updatedAt,
    updated_at: updatedAt,
    metadata: row.metadata || {},

    canDelete: canWorkerDeleteStatus(status),
    can_delete: canWorkerDeleteStatus(status),
    canReplace: canReplaceStatus(status),
    can_replace: canReplaceStatus(status)
  };
}

function baseDocumentSelect() {
  return `
    SELECT wd.id,
           wd.worker_id,
           wd.company_id,
           wd.document_type,
           wd.title,
           wd.description,
           wd.file_name,
           wd.file_url,
           wd.file_path,
           wd.mime_type,
           wd.size_bytes,
           wd.status,
           wd.uploaded_by,
           wd.uploaded_at,
           wd.reviewed_by,
           wd.reviewed_at,
           wd.review_comment,
           wd.updated_at,
           wd.deleted_at,
           wd.is_required,
           wd.due_date,
           wd.metadata,
           COALESCE(
             NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name)), ''),
             NULLIF(wu.full_name, ''),
             NULLIF(TRIM(CONCAT_WS(' ', wu.first_name, wu.last_name)), '')
           ) AS worker_name,
           wu.email AS worker_email,
           CONCAT_WS(' ', uploader.first_name, uploader.last_name) AS uploaded_by_name,
           CONCAT_WS(' ', reviewer.first_name, reviewer.last_name) AS reviewed_by_name
    FROM worker_documents wd
    JOIN workers w ON w.id = wd.worker_id
    LEFT JOIN users wu ON wu.id = w.user_id
    LEFT JOIN users uploader ON uploader.id = wd.uploaded_by
    LEFT JOIN users reviewer ON reviewer.id = wd.reviewed_by
  `;
}

async function assertWorkerBelongsToCompany(workerId, companyId, db = { query }) {
  const result = await db.query(
    `SELECT id
     FROM workers
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [workerId, companyId]
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'WORKER_NOT_FOUND', 'Trabajador no encontrado.');
  }

  return result.rows[0];
}

async function getDocumentById(documentId, companyId, db = { query }) {
  const result = await db.query(`
    ${baseDocumentSelect()}
    WHERE wd.id = $1
      AND wd.company_id = $2
      AND w.company_id = $2
      AND w.deleted_at IS NULL
      AND wd.deleted_at IS NULL
      AND LOWER(COALESCE(wd.status, '')) <> 'deleted'
    LIMIT 1
  `, [documentId, companyId]);

  return result.rows[0] ? serializeDocument(result.rows[0]) : null;
}

async function getMyDocuments(workerId, companyId, filters = {}) {
  return getWorkerDocuments(workerId, companyId, filters);
}

async function getWorkerDocuments(workerId, companyId, filters = {}) {
  await assertWorkerBelongsToCompany(workerId, companyId);

  const params = [workerId, companyId];
  const whereClauses = [
    'wd.worker_id = $1',
    'wd.company_id = $2',
    'w.company_id = $2',
    'w.deleted_at IS NULL',
    'wd.deleted_at IS NULL',
    "LOWER(COALESCE(wd.status, '')) <> 'deleted'"
  ];
  let index = 3;

  const status = filters.status || filters.documentStatus || filters.document_status;
  if (status) {
    whereClauses.push(`LOWER(wd.status) = LOWER($${index++})`);
    params.push(status);
  }

  const type = filters.type || filters.documentType || filters.document_type;
  if (type) {
    whereClauses.push(`LOWER(wd.document_type) = LOWER($${index++})`);
    params.push(type);
  }

  const result = await query(`
    ${baseDocumentSelect()}
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY
      CASE LOWER(COALESCE(wd.status, ''))
        WHEN 'missing' THEN 0
        WHEN 'observed' THEN 1
        WHEN 'pending' THEN 2
        ELSE 3
      END,
      COALESCE(wd.updated_at, wd.uploaded_at) DESC NULLS LAST,
      wd.id DESC
  `, params);

  return result.rows.map(serializeDocument);
}

async function getCompanyDocuments(companyId, filters = {}) {
  const page = parsePositiveInt(filters.page, 1, 10000);
  const limit = parsePositiveInt(filters.pageSize || filters.page_size || filters.limit, 20, 100);
  const offset = (page - 1) * limit;

  const params = [companyId];
  const whereClauses = [
    'wd.company_id = $1',
    'w.company_id = $1',
    'w.deleted_at IS NULL',
    'wd.deleted_at IS NULL',
    "LOWER(COALESCE(wd.status, '')) <> 'deleted'"
  ];
  let index = 2;

  const workerId = filters.workerId || filters.worker_id;
  if (workerId) {
    whereClauses.push(`wd.worker_id = $${index++}`);
    params.push(workerId);
  }

  const status = filters.status || filters.documentStatus || filters.document_status;
  if (status) {
    whereClauses.push(`LOWER(wd.status) = LOWER($${index++})`);
    params.push(status);
  }

  const type = filters.type || filters.documentType || filters.document_type || filters.document_type_id;
  if (type) {
    whereClauses.push(`LOWER(wd.document_type) = LOWER($${index++})`);
    params.push(type);
  }

  const search = String(filters.search || filters.q || '').trim();
  if (search) {
    whereClauses.push(`(
      LOWER(COALESCE(wd.file_name, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(wd.title, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(wd.document_type, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(wu.email, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(w.document_number, '')) LIKE LOWER($${index})
      OR LOWER(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name, wu.full_name, wu.first_name, wu.last_name)) LIKE LOWER($${index})
    )`);
    params.push(`%${search}%`);
    index += 1;
  }

  const whereSql = whereClauses.join(' AND ');
  const dataQuery = `
    ${baseDocumentSelect()}
    WHERE ${whereSql}
    ORDER BY COALESCE(wd.updated_at, wd.uploaded_at) DESC NULLS LAST, wd.id DESC
    LIMIT $${index++} OFFSET $${index++}
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM worker_documents wd
    JOIN workers w ON w.id = wd.worker_id
    LEFT JOIN users wu ON wu.id = w.user_id
    WHERE ${whereSql}
  `;

  const [dataRes, countRes] = await Promise.all([
    query(dataQuery, [...params, limit, offset]),
    query(countQuery, params)
  ]);

  const total = parseInt(countRes.rows[0]?.total || 0, 10);
  return {
    documents: dataRes.rows.map(serializeDocument),
    pagination: {
      total,
      page,
      limit,
      pageSize: limit,
      page_size: limit,
      totalPages: Math.ceil(total / limit),
      total_pages: Math.ceil(total / limit)
    }
  };
}

function normalizeFileInput(file, body = {}) {
  if (file) {
    return file;
  }

  const contentBase64 = body.contentBase64 || body.content_base64;
  if (!contentBase64) {
    return null;
  }

  const fileName = body.fileName || body.file_name || body.name || `documento-${Date.now()}.pdf`;
  const mimeType = body.mimeType || body.mime_type || 'application/pdf';
  const buffer = Buffer.from(contentBase64, 'base64');

  return {
    buffer,
    mimetype: mimeType,
    originalname: fileName,
    size: buffer.length
  };
}

async function findReplaceableRequirement({ db, workerId, companyId, documentType }) {
  const result = await db.query(
    `SELECT id, status
     FROM worker_documents
     WHERE worker_id = $1
       AND company_id = $2
       AND LOWER(document_type) = LOWER($3)
       AND deleted_at IS NULL
       AND (file_url IS NULL OR file_url = '')
       AND LOWER(COALESCE(status, '')) IN ('missing', 'pending', 'observed', 'rejected')
     ORDER BY uploaded_at ASC NULLS LAST
     LIMIT 1`,
    [workerId, companyId, documentType]
  );

  return result.rows[0] || null;
}

async function uploadDocument({ file, body = {}, workerId, companyId, uploadedBy, db = { query } }) {
  await assertWorkerBelongsToCompany(workerId, companyId, db);

  const resolvedFile = normalizeFileInput(file, body);
  if (!resolvedFile?.buffer) {
    throw createHttpError(400, 'NO_FILE_ATTACHED', 'Debes adjuntar un archivo.');
  }

  const documentType = normalizeDocumentType(
    body.type || body.documentType || body.document_type || body.documentTypeCode || body.document_type_code
  );
  const title = body.title || body.name || body.documentName || body.document_name || null;
  const description = body.description || null;
  const requestedDocumentId = body.documentId || body.document_id || null;
  const dueDate = body.dueDate || body.due_date || null;
  const metadata = {
    source: body.source || 'worker_document_upload',
    original_name: resolvedFile.originalname || null
  };

  const { fileName, filePath } = buildStoragePath({
    companyId,
    workerId,
    file: resolvedFile
  });
  const publicUrl = await uploadFile(resolvedFile, BUCKET_NAME, filePath);

  let documentId = requestedDocumentId;
  if (!documentId) {
    const replaceable = await findReplaceableRequirement({ db, workerId, companyId, documentType });
    documentId = replaceable?.id || null;
  }

  if (documentId) {
    const existing = await db.query(
      `SELECT id, status
       FROM worker_documents
       WHERE id = $1
         AND worker_id = $2
         AND company_id = $3
         AND deleted_at IS NULL
       LIMIT 1`,
      [documentId, workerId, companyId]
    );

    if (!existing.rows[0]) {
      throw createHttpError(404, 'DOCUMENT_NOT_FOUND', 'Documento no encontrado.');
    }

    if (!canReplaceStatus(existing.rows[0].status)) {
      throw createHttpError(422, 'DOCUMENT_NOT_REPLACEABLE', 'Este documento no puede ser reemplazado por su estado actual.');
    }

    await db.query(
      `UPDATE worker_documents
       SET document_type = $1,
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           file_name = $4,
           file_url = $5,
           file_path = $6,
           mime_type = $7,
           size_bytes = $8,
           status = 'pending',
           uploaded_by = $9,
           uploaded_at = NOW(),
           reviewed_by = NULL,
           reviewed_at = NULL,
           review_comment = NULL,
           due_date = COALESCE($10, due_date),
           metadata = COALESCE(metadata, '{}'::jsonb) || $11::jsonb,
           updated_at = NOW()
       WHERE id = $12`,
      [
        documentType,
        title,
        description,
        fileName,
        publicUrl,
        filePath,
        resolvedFile.mimetype,
        resolvedFile.size || resolvedFile.buffer.length,
        uploadedBy,
        dueDate,
        JSON.stringify(metadata),
        documentId
      ]
    );

    return getDocumentById(documentId, companyId, db);
  }

  const inserted = await db.query(
    `INSERT INTO worker_documents
      (worker_id, company_id, document_type, title, description, file_name, file_url, file_path,
       mime_type, size_bytes, status, uploaded_by, is_required, due_date, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, $14::jsonb)
     RETURNING id`,
    [
      workerId,
      companyId,
      documentType,
      title || toTitle(documentType),
      description,
      fileName,
      publicUrl,
      filePath,
      resolvedFile.mimetype,
      resolvedFile.size || resolvedFile.buffer.length,
      uploadedBy,
      parseBoolean(body.isRequired) || parseBoolean(body.is_required),
      dueDate,
      JSON.stringify(metadata)
    ]
  );

  return getDocumentById(inserted.rows[0].id, companyId, db);
}

async function uploadDocuments({ files = [], body = {}, workerId, companyId, uploadedBy, db = { query } }) {
  const normalizedFiles = files.length > 0 ? files : [null];
  const documents = [];

  for (const file of normalizedFiles) {
    const document = await uploadDocument({
      file,
      body,
      workerId,
      companyId,
      uploadedBy,
      db
    });
    documents.push(document);
  }

  return documents;
}

async function reviewDocument({ documentId, companyId, status, reviewComment = null, reviewedBy }) {
  const normalizedStatus = normalizeStatus(status);
  if (!REVIEW_STATUSES.has(normalizedStatus)) {
    throw createHttpError(422, 'INVALID_DOCUMENT_STATUS', 'Estado de documento invalido.', {
      allowed: [...REVIEW_STATUSES]
    });
  }

  const existing = await getDocumentById(documentId, companyId);
  if (!existing) {
    throw createHttpError(404, 'DOCUMENT_NOT_FOUND', 'Documento no encontrado.');
  }

  await query(
    `UPDATE worker_documents
     SET status = $1,
         review_comment = $2,
         reviewed_by = $3,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $4
       AND company_id = $5
       AND deleted_at IS NULL`,
    [normalizedStatus, reviewComment, reviewedBy, documentId, companyId]
  );

  return getDocumentById(documentId, companyId);
}

async function deleteDocument({ documentId, companyId, deletedBy, reason = null, workerId = null, force = false }) {
  const existing = await getDocumentById(documentId, companyId);
  if (!existing || (workerId && existing.workerId !== workerId)) {
    throw createHttpError(404, 'DOCUMENT_NOT_FOUND', 'Documento no encontrado.');
  }

  if (!force && !canWorkerDeleteStatus(existing.status)) {
    throw createHttpError(422, 'DOCUMENT_NOT_DELETABLE', 'No se puede eliminar un documento aprobado, generado o firmado.');
  }

  await query(
    `UPDATE worker_documents
     SET status = 'deleted',
         deleted_at = NOW(),
         deleted_by = $1,
         delete_reason = $2,
         updated_at = NOW()
     WHERE id = $3
       AND company_id = $4
       AND deleted_at IS NULL`,
    [deletedBy, reason, documentId, companyId]
  );

  return {
    id: documentId,
    deleted: true,
    deletedAt: new Date().toISOString(),
    deleted_at: new Date().toISOString()
  };
}

function normalizeRequiredDocument(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    return {
      documentType: input,
      title: toTitle(input),
      description: null,
      dueDate: null
    };
  }

  const documentType = input.type || input.documentType || input.document_type;
  if (!documentType) {
    return null;
  }

  return {
    documentType,
    title: input.title || input.name || toTitle(documentType),
    description: input.description || null,
    dueDate: input.dueDate || input.due_date || null
  };
}

async function createRequiredDocuments({ db = { query }, workerId, companyId, documents = [], createdBy = null }) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return [];
  }

  await assertWorkerBelongsToCompany(workerId, companyId, db);

  const created = [];
  for (const raw of documents) {
    const item = normalizeRequiredDocument(raw);
    if (!item) {
      continue;
    }

    const documentType = normalizeDocumentType(item.documentType);
    const existing = await db.query(
      `SELECT id
       FROM worker_documents
       WHERE worker_id = $1
         AND company_id = $2
         AND LOWER(document_type) = LOWER($3)
         AND deleted_at IS NULL
         AND is_required = TRUE
         AND LOWER(COALESCE(status, '')) IN ('missing', 'pending', 'observed')
       LIMIT 1`,
      [workerId, companyId, documentType]
    );

    if (existing.rows[0]) {
      continue;
    }

    const inserted = await db.query(
      `INSERT INTO worker_documents
        (worker_id, company_id, document_type, title, description, file_url, status,
         uploaded_by, is_required, due_date, metadata)
       VALUES ($1, $2, $3, $4, $5, NULL, 'missing', $6, TRUE, $7, $8::jsonb)
       RETURNING id`,
      [
        workerId,
        companyId,
        documentType,
        item.title,
        item.description,
        createdBy,
        item.dueDate,
        JSON.stringify({ source: 'onboarding_required_document' })
      ]
    );

    const document = await getDocumentById(inserted.rows[0].id, companyId, db);
    if (document) {
      created.push(document);
    }
  }

  return created;
}

async function getDocumentTypes(companyId) {
  const result = await query(
    `SELECT document_type AS type,
            COUNT(*)::int AS usage_count
     FROM worker_documents
     WHERE company_id = $1
       AND deleted_at IS NULL
       AND LOWER(COALESCE(status, '')) <> 'deleted'
     GROUP BY document_type
     ORDER BY document_type ASC`,
    [companyId]
  );

  const defaults = ['DNI', 'CONTRACT', 'SIGNED_CONTRACT', 'GENERATED_CONTRACT', 'CV', 'MEDICAL_CERTIFICATE', 'OTHER'];
  const known = new Map();

  defaults.forEach((type) => {
    known.set(type, { type, documentType: type, document_type: type, label: toTitle(type), usageCount: 0, usage_count: 0 });
  });

  result.rows.forEach((row) => {
    const type = row.type || 'OTHER';
    known.set(type, {
      type,
      documentType: type,
      document_type: type,
      label: toTitle(type),
      usageCount: Number(row.usage_count || 0),
      usage_count: Number(row.usage_count || 0)
    });
  });

  return [...known.values()];
}

module.exports = {
  serializeDocument,
  getMyDocuments,
  getWorkerDocuments,
  getCompanyDocuments,
  getDocumentById,
  uploadDocument,
  uploadDocuments,
  reviewDocument,
  deleteDocument,
  createRequiredDocuments,
  getDocumentTypes
};
