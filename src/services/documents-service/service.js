const path = require('path');
const crypto = require('crypto');
const { query } = require('../../config/database');
const env = require('../../config/env');
const { uploadFile, deleteFile } = require('../../shared/utils/storage.utils');
const { isValidUUID } = require('../../utils/uuid.util');
const logger = require('../../shared/utils/logger');

const BUCKET_NAME = env.workerDocumentsBucket || env.requestDocumentsBucket;

const DOCUMENT_TYPES = Object.freeze([
  'DNI',
  'CV',
  'MEDICAL_CERTIFICATE',
  'BACKGROUND_CHECK',
  'STUDIES_CERTIFICATE'
]);
const DOCUMENT_TYPE_SET = new Set(DOCUMENT_TYPES);
const DOCUMENT_STATUSES = Object.freeze([
  'missing',
  'pending',
  'approved',
  'rejected',
  'observed',
  'generated',
  'signed',
  'expired',
  'available'
]);
const DOCUMENT_STATUS_SET = new Set(DOCUMENT_STATUSES);
const FINAL_DOCUMENT_STATUSES = new Set(['approved', 'generated', 'signed']);
const REPLACEABLE_DOCUMENT_STATUSES = new Set(['missing', 'pending', 'observed', 'rejected', 'expired', 'available']);
const REVIEW_STATUSES = new Set(['approved', 'rejected', 'observed']);
const COMMENT_REQUIRED_REVIEW_STATUSES = new Set(['rejected', 'observed']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DOCUMENT_TYPE_LABELS = new Map([
  ['generated_request_document', 'Solicitud generada'],
  ['signed_request_document', 'Solicitud firmada'],
  ['generated_contract', 'Contrato generado'],
  ['signed_contract', 'Contrato firmado']
]);

function createHttpError(statusCode, errorCode, message, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (details) {
    error.details = details;
  }
  return error;
}

function parsePaginationValue(value, { field, fallback, max }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (!/^\d+$/.test(String(value))) {
    throw createHttpError(400, 'INVALID_PAGINATION', `${field} debe ser un entero positivo.`, { field, max });
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw createHttpError(400, 'INVALID_PAGINATION', `${field} debe estar entre 1 y ${max}.`, { field, max });
  }

  return parsed;
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
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === 'uploaded' || normalized === 'active') {
    return 'available';
  }
  return normalized;
}

function assertAllowedDocumentType(value) {
  const normalized = normalizeDocumentType(value);
  if (!value || !DOCUMENT_TYPE_SET.has(normalized)) {
    throw createHttpError(422, 'INVALID_DOCUMENT_TYPE', 'Tipo de documento no permitido.', {
      allowed: DOCUMENT_TYPES
    });
  }
  return normalized;
}

function assertAllowedStatusFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!DOCUMENT_STATUS_SET.has(normalized)) {
    throw createHttpError(422, 'INVALID_DOCUMENT_STATUS', 'Estado de documento no permitido.', {
      allowed: DOCUMENT_STATUSES
    });
  }
  return normalized;
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

function getDocumentTypeLabel(type) {
  return DOCUMENT_TYPE_LABELS.get(String(type || '').toLowerCase()) || toTitle(type);
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
  if (ext === '.jpeg') return '.jpg';
  if (['.pdf', '.png', '.jpg'].includes(ext)) return ext;
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime === 'application/pdf') return '.pdf';
  if (['image/jpeg', 'image/jpg', 'image/pjpeg'].includes(mime)) return '.jpg';
  if (['image/png', 'image/x-png'].includes(mime)) return '.png';
  return '';
}

function buildStoragePath({ companyId, workerId, documentId, contentHash, file }) {
  const ext = getFileExtension(file);
  return {
    fileName: sanitizeFileName(file?.originalname || `documento${ext}`),
    filePath: `${companyId}/workers/${workerId}/${documentId}/${contentHash}`
  };
}

function getDetectedFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return null;
  }

  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= pngSignature.length && buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return 'image/png';
  }

  return null;
}

function normalizeMimeType(value) {
  const mimeType = String(value || '').toLowerCase();
  if (['image/jpeg', 'image/jpg', 'image/pjpeg'].includes(mimeType)) return 'image/jpeg';
  if (['image/png', 'image/x-png'].includes(mimeType)) return 'image/png';
  if (mimeType === 'application/pdf') return mimeType;
  return null;
}

function validateDocumentFile(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    throw createHttpError(400, 'NO_FILE_ATTACHED', 'Debes adjuntar un único archivo bajo el campo "file".');
  }

  const sizeBytes = Number(file.size || file.buffer.length);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw createHttpError(422, 'EMPTY_DOCUMENT_FILE', 'El archivo está vacío.');
  }
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw createHttpError(422, 'DOCUMENT_FILE_TOO_LARGE', 'El archivo supera el tamaño máximo de 10 MB.', {
      maxSizeBytes: MAX_FILE_SIZE_BYTES
    });
  }

  const declaredType = normalizeMimeType(file.mimetype);
  const detectedType = getDetectedFileType(file.buffer);
  const extension = getFileExtension(file);
  const expectedExtension = detectedType === 'application/pdf'
    ? '.pdf'
    : (detectedType === 'image/png' ? '.png' : '.jpg');

  if (!declaredType || !detectedType || declaredType !== detectedType || extension !== expectedExtension) {
    throw createHttpError(422, 'UNSUPPORTED_DOCUMENT_FILE', 'El contenido debe corresponder a un archivo PDF, PNG o JPG válido.', {
      allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      maxSizeBytes: MAX_FILE_SIZE_BYTES
    });
  }

  return {
    ...file,
    mimetype: detectedType,
    size: sizeBytes
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
    typeLabel: row.type_label || getDocumentTypeLabel(type),
    type_label: row.type_label || getDocumentTypeLabel(type),
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
  const page = parsePaginationValue(filters.page, { field: 'page', fallback: 1, max: 100000 });
  const requestedPageSize = filters.pageSize ?? filters.page_size ?? filters.limit;
  const limit = parsePaginationValue(requestedPageSize, { field: 'pageSize', fallback: 10, max: 100 });
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
    if (!isValidUUID(workerId)) {
      throw createHttpError(400, 'INVALID_WORKER_ID', 'workerId invalido. Debe ser un UUID valido.', {
        field: 'workerId'
      });
    }
    whereClauses.push(`wd.worker_id = $${index++}`);
    params.push(workerId);
  }

  const status = filters.status || filters.documentStatus || filters.document_status;
  if (status) {
    const normalizedStatus = assertAllowedStatusFilter(status);
    whereClauses.push(`LOWER(wd.status) = LOWER($${index++})`);
    params.push(normalizedStatus);
  }

  const type = filters.type || filters.documentType || filters.document_type || filters.document_type_id;
  if (type) {
    const normalizedType = assertAllowedDocumentType(type);
    whereClauses.push(`LOWER(wd.document_type) = LOWER($${index++})`);
    params.push(normalizedType);
  }

  const search = String(filters.search || filters.q || '').trim();
  if (search) {
    if (search.length > 200) {
      throw createHttpError(400, 'INVALID_SEARCH', 'search no puede superar 200 caracteres.', {
        field: 'search',
        maxLength: 200
      });
    }
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

  const resolvedFile = validateDocumentFile(normalizeFileInput(file, body));
  const documentType = assertAllowedDocumentType(
    body.type || body.documentType || body.document_type || body.documentTypeCode || body.document_type_code
  );
  const title = String(body.title || body.name || body.documentName || body.document_name || '').trim();
  const description = String(body.description || '').trim() || null;
  const requestedDocumentId = body.documentId || body.document_id || null;
  const dueDate = body.dueDate || body.due_date || null;
  if (!title) {
    throw createHttpError(422, 'DOCUMENT_TITLE_REQUIRED', 'El título es obligatorio.', {
      field: 'title'
    });
  }
  if (title.length > 255) {
    throw createHttpError(422, 'DOCUMENT_TITLE_TOO_LONG', 'El título no puede superar 255 caracteres.', {
      field: 'title',
      maxLength: 255
    });
  }
  if (description && description.length > 2000) {
    throw createHttpError(422, 'DOCUMENT_DESCRIPTION_TOO_LONG', 'La descripción no puede superar 2000 caracteres.', {
      field: 'description',
      maxLength: 2000
    });
  }
  if (requestedDocumentId && !isValidUUID(requestedDocumentId)) {
    throw createHttpError(400, 'INVALID_DOCUMENT_ID', 'documentId invalido. Debe ser un UUID valido.', {
      field: 'documentId'
    });
  }

  const contentHash = crypto.createHash('sha256').update(resolvedFile.buffer).digest('hex');
  const metadata = {
    source: body.source || 'worker_document_upload',
    original_name: resolvedFile.originalname || null,
    content_sha256: contentHash
  };

  let documentId = requestedDocumentId;
  if (!documentId) {
    const replaceable = await findReplaceableRequirement({ db, workerId, companyId, documentType });
    documentId = replaceable?.id || null;
  }

  let existingDocument = null;
  if (documentId) {
    const existing = await db.query(
      `SELECT id, status, file_path, content_sha256
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

    existingDocument = existing.rows[0];
    if (existingDocument.content_sha256 === contentHash) {
      throw createHttpError(422, 'DOCUMENT_FILE_UNCHANGED', 'El archivo es idéntico al documento actual.');
    }
  } else {
    documentId = crypto.randomUUID();
  }

  const duplicate = await db.query(
    `SELECT id
     FROM worker_documents
     WHERE company_id = $1
       AND content_sha256 = $2
       AND deleted_at IS NULL
       AND LOWER(COALESCE(status, '')) <> 'deleted'
       AND id <> $3
     LIMIT 1`,
    [companyId, contentHash, documentId]
  );
  if (duplicate.rows[0]) {
    throw createHttpError(422, 'DUPLICATE_DOCUMENT_FILE', 'Este archivo ya está registrado en el Centro de Documentos.', {
      existingDocumentId: duplicate.rows[0].id
    });
  }

  const { fileName, filePath } = buildStoragePath({
    companyId,
    workerId,
    documentId,
    contentHash,
    file: resolvedFile
  });
  const publicUrl = await uploadFile(resolvedFile, BUCKET_NAME, filePath);

  try {
    if (existingDocument) {
      await db.query(
        `UPDATE worker_documents
         SET document_type = $1,
             title = $2,
             description = $3,
             file_name = $4,
             file_url = $5,
             file_path = $6,
             mime_type = $7,
             size_bytes = $8,
             content_sha256 = $9,
             status = 'pending',
             uploaded_by = $10,
             uploaded_at = NOW(),
             reviewed_by = NULL,
             reviewed_at = NULL,
             review_comment = NULL,
             due_date = COALESCE($11, due_date),
             metadata = COALESCE(metadata, '{}'::jsonb) || $12::jsonb,
             updated_at = NOW()
         WHERE id = $13`,
        [
          documentType,
          title,
          description,
          fileName,
          publicUrl,
          filePath,
          resolvedFile.mimetype,
          resolvedFile.size,
          contentHash,
          uploadedBy,
          dueDate,
          JSON.stringify(metadata),
          documentId
        ]
      );

      if (existingDocument.file_path && existingDocument.file_path !== filePath) {
        try {
          await deleteFile(BUCKET_NAME, existingDocument.file_path);
        } catch (cleanupError) {
          logger.logError('DOCUMENTS', 'No se pudo retirar la versión reemplazada de Storage', cleanupError, {
            documentId,
            filePath: existingDocument.file_path
          });
        }
      }
    } else {
      await db.query(
        `INSERT INTO worker_documents
          (id, worker_id, company_id, document_type, title, description, file_name, file_url, file_path,
           mime_type, size_bytes, content_sha256, status, uploaded_by, is_required, due_date, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15, $16::jsonb)`,
        [
          documentId,
          workerId,
          companyId,
          documentType,
          title,
          description,
          fileName,
          publicUrl,
          filePath,
          resolvedFile.mimetype,
          resolvedFile.size,
          contentHash,
          uploadedBy,
          parseBoolean(body.isRequired) || parseBoolean(body.is_required),
          dueDate,
          JSON.stringify(metadata)
        ]
      );
    }
  } catch (error) {
    let shouldDeleteUploadedFile = error.code !== '23505';
    if (error.code === '23505') {
      try {
        const winner = await db.query(
          `SELECT file_path
           FROM worker_documents
           WHERE company_id = $1
             AND content_sha256 = $2
             AND deleted_at IS NULL
             AND LOWER(COALESCE(status, '')) <> 'deleted'
           LIMIT 1`,
          [companyId, contentHash]
        );
        shouldDeleteUploadedFile = winner.rows[0]?.file_path !== filePath;
      } catch (lookupError) {
        logger.logError('DOCUMENTS', 'No se pudo verificar el archivo ganador tras una carga duplicada', lookupError, {
          documentId,
          filePath
        });
      }
    }

    if (shouldDeleteUploadedFile) {
      try {
        await deleteFile(BUCKET_NAME, filePath);
      } catch (cleanupError) {
        logger.logError('DOCUMENTS', 'No se pudo revertir una carga fallida en Storage', cleanupError, {
          documentId,
          filePath
        });
      }
    }

    if (error.code === '23505') {
      throw createHttpError(422, 'DUPLICATE_DOCUMENT_FILE', 'Este archivo ya está registrado en el Centro de Documentos.');
    }
    throw error;
  }

  return getDocumentById(documentId, companyId, db);
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

  const normalizedComment = String(reviewComment || '').trim() || null;
  if (COMMENT_REQUIRED_REVIEW_STATUSES.has(normalizedStatus) && !normalizedComment) {
    throw createHttpError(422, 'REVIEW_COMMENT_REQUIRED', 'El comentario es obligatorio para documentos rechazados u observados.', {
      field: 'reviewComment',
      status: normalizedStatus
    });
  }
  if (normalizedComment && normalizedComment.length > 2000) {
    throw createHttpError(422, 'REVIEW_COMMENT_TOO_LONG', 'El comentario no puede superar 2000 caracteres.', {
      field: 'reviewComment',
      maxLength: 2000
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
    [normalizedStatus, normalizedComment, reviewedBy, documentId, companyId]
  );

  return getDocumentById(documentId, companyId);
}

async function deleteDocument({ documentId, companyId, deletedBy, reason = null, workerId = null }) {
  const existing = await getDocumentById(documentId, companyId);
  if (!existing || (workerId && existing.workerId !== workerId)) {
    throw createHttpError(404, 'DOCUMENT_NOT_FOUND', 'Documento no encontrado.');
  }

  if (!canWorkerDeleteStatus(existing.status)) {
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

  if (existing.filePath) {
    try {
      await deleteFile(BUCKET_NAME, existing.filePath);
    } catch (cleanupError) {
      logger.logError('DOCUMENTS', 'No se pudo retirar el documento eliminado de Storage', cleanupError, {
        documentId,
        filePath: existing.filePath
      });
    }
  }

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
  return [...DOCUMENT_TYPES];
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
