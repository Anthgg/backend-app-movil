const { query } = require('../../../config/database');
const env = require('../../../config/env');
const { getSupabaseClient } = require('../../../config/supabase');
const logger = require('../../../shared/utils/logger');
const path = require('path');
const crypto = require('crypto');
const { uploadFile } = require('../../../shared/utils/storage.utils');
const { generateRequestDocumentPdf } = require('../../../templates/pdf/request-document.template');
const { getCompanySettings } = require('../../company-settings-service/companySettings.service');
const requestService = require('./request.service');
const { insertReturning } = require('../../../utils/db.util');
const { buildWorkerStoragePath, getFileExtension, sanitizeFileName } = require('../../../utils/file-upload.util');
const { logAuditEvent } = require('../../../utils/audit.util');
const { assertValidUUID } = require('../../../utils/uuid.util');
const { resolveRequestDocumentConfig } = require('./requestDocument.config');

const BUCKET_NAME = env.requestDocumentsBucket;
const MAX_SIGNED_REQUEST_DOCUMENT_SIZE_BYTES = parseInt(process.env.SIGNED_REQUEST_DOCUMENT_MAX_BYTES || '', 10) || 10 * 1024 * 1024;
const ALLOWED_SIGNED_REQUEST_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png'
]);
const ALLOWED_SIGNED_REQUEST_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) error.errors = errors;
  return error;
}

function assertValidRequestId(requestId) {
  assertValidUUID(requestId, {
    field: 'requestId',
    errorCode: 'INVALID_REQUEST_ID',
    message: 'requestId invalido. Debe ser un UUID valido.'
  });
}

function validateSignedRequestDocumentFile(file) {
  if (!file) {
    throw createHttpError(400, 'SIGNED_REQUEST_DOCUMENT_REQUIRED', 'El archivo firmado de la solicitud es obligatorio.');
  }

  const mimeType = String(file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();

  if (!ALLOWED_SIGNED_REQUEST_DOCUMENT_MIME_TYPES.has(mimeType) || !ALLOWED_SIGNED_REQUEST_DOCUMENT_EXTENSIONS.has(extension)) {
    throw createHttpError(415, 'INVALID_FILE_TYPE', 'Tipo de archivo no permitido. Se aceptan PDF, JPG y PNG.');
  }

  if (file.size > MAX_SIGNED_REQUEST_DOCUMENT_SIZE_BYTES) {
    throw createHttpError(413, 'FILE_TOO_LARGE', 'El archivo supera el tamano maximo permitido.');
  }
}

function safeRequestBaseName(request) {
  return sanitizeFileName(String(request.request_code || request.id || 'solicitud').toLowerCase());
}

function fileNameFromPath(filePath, fallback = 'documento.pdf') {
  const value = String(filePath || '').trim();
  if (!value) return fallback;
  return path.basename(value) || fallback;
}

function buildWorkerDocumentTitle(documentType, request, templateConfig) {
  const code = request.request_code ? ` ${request.request_code}` : '';
  const typeLabel = templateConfig?.typeLabel ? ` - ${templateConfig.typeLabel}` : '';

  if (documentType === 'signed_request_document') {
    return `Solicitud laboral firmada${code}${typeLabel}`;
  }

  return `Solicitud laboral generada${code}${typeLabel}`;
}

class RequestDocumentService {
  async getRequestForCompany(requestId, companyId) {
    assertValidRequestId(requestId);

    const result = await query(`
      SELECT r.*,
             rt.name AS type_name,
             rt.code AS type_code,
             w.id AS resolved_worker_id,
             w.company_id AS resolved_company_id,
             w.document_type,
             w.document_number,
             w.personal_id,
             w.first_name,
             w.paternal_last_name,
             w.maternal_last_name,
             w.phone_number,
             w.address,
             w.hire_date,
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', w.first_name, w.paternal_last_name, w.maternal_last_name)), ''),
               NULLIF(TRIM(CONCAT_WS(' ', worker_user.first_name, worker_user.last_name)), '')
             ) AS worker_name,
             jp.name AS position_name,
             a.name AS area_name,
             wl.name AS work_location_name,
             c.name AS company_name,
             c.ruc AS company_ruc,
             c.address AS company_address,
             NULLIF(TRIM(CONCAT_WS(' ', reviewer.first_name, reviewer.last_name)), '') AS rrhh_responsible_name
      FROM employee_requests r
      JOIN workers w ON w.id = r.worker_id
      LEFT JOIN users worker_user ON worker_user.id = w.user_id
      LEFT JOIN request_types rt ON rt.id = r.request_type_id
      LEFT JOIN job_positions jp ON jp.id = COALESCE(w.position_id, w.job_position_id)
      LEFT JOIN areas a ON a.id = w.area_id
      LEFT JOIN work_locations wl ON wl.id = w.work_location_id
      LEFT JOIN companies c ON c.id = r.company_id
      LEFT JOIN users reviewer ON reviewer.id = r.approved_by
      WHERE r.id = $1
        AND r.company_id = $2
        AND w.deleted_at IS NULL
      LIMIT 1
    `, [requestId, companyId]);

    return result.rows[0] || null;
  }

  async generateRequestDocument({ requestId, companyId, generatedBy, req = null }) {
    const request = await this.getRequestForCompany(requestId, companyId);
    if (!request) {
      throw createHttpError(404, 'REQUEST_NOT_FOUND', 'Solicitud no encontrada.');
    }

    if (!request.request_code) {
      const tracking = await requestService.assignRequestTrackingCode(
        requestId,
        { code: request.type_code, name: request.type_name }
      );
      Object.assign(request, tracking);
    }

    const companySettings = await getCompanySettings(companyId);
    const pdfBuffer = await generateRequestDocumentPdf({
      request,
      worker: request,
      companyConfig: companySettings || {},
      generatedBy: req?.user?.email || 'RR.HH.',
      generatedAt: new Date()
    });

    const timestamp = Date.now();
    const fileName = `solicitud-generada-${safeRequestBaseName(request)}-${timestamp}.pdf`;
    const filePath = buildWorkerStoragePath({
      companyId,
      workerId: request.resolved_worker_id,
      folder: 'requests/generated',
      fileName
    });

    const fileUrl = await uploadFile({
      buffer: pdfBuffer,
      mimetype: 'application/pdf',
      originalname: fileName,
      size: pdfBuffer.length
    }, BUCKET_NAME, filePath);

    const templateConfig = resolveRequestDocumentConfig(request.type_code, request.type_name);
    const document = await insertReturning({ query }, 'request_documents', {
      company_id: companyId,
      request_id: requestId,
      document_type: 'generated_request_document',
      file_url: fileUrl,
      file_path: filePath,
      mime_type: 'application/pdf',
      file_size: pdfBuffer.length,
      status: 'generated',
      uploaded_by: generatedBy,
      metadata: {
        source: 'request_document_generate',
        request_code: request.request_code || null,
        template_key: templateConfig.key,
        template_title: templateConfig.title,
        generated_at: new Date().toISOString()
      }
    });

    await this.#registerWorkerDocumentForRequest({
      request,
      companyId,
      requestId,
      requestDocument: document,
      documentType: 'generated_request_document',
      fileName,
      fileUrl,
      filePath,
      mimeType: 'application/pdf',
      sizeBytes: pdfBuffer.length,
      status: 'generated',
      uploadedBy: generatedBy,
      templateConfig,
      metadata: {
        source: 'request_document_generate',
        generated_at: new Date().toISOString()
      }
    });

    await logAuditEvent({
      userId: generatedBy,
      companyId,
      module: 'REQUESTS',
      action: 'REQUEST_DOCUMENT_GENERATED',
      entity: 'request_documents',
      entityId: document.id || requestId,
      newData: {
        request_id: requestId,
        request_code: request.request_code || null,
        file_url: fileUrl,
        file_name: fileName
      },
      req: req || {}
    });

    return {
      request_id: requestId,
      request_code: request.request_code || null,
      worker_id: request.resolved_worker_id,
      document,
      pdf_url: fileUrl,
      file_url: fileUrl,
      file_name: fileName,
      file_path: filePath
    };
  }

  /**
   * Sube un archivo a Supabase Storage y registra en request_documents.
   * @param {Object} params
   * @param {Object} params.file - Archivo de Multer (buffer, mimetype, originalname, size)
   * @param {string} params.requestId - UUID de la solicitud
   * @param {string} params.companyId - UUID del tenant
   * @param {string} params.uploadedBy - UUID del usuario que sube
   * @param {string} [params.documentType] - Tipo de documento (optional label)
   * @returns {Object} Registro insertado en request_documents
   */
  async uploadDocument({ file, requestId, companyId, uploadedBy, documentType }) {
    // 1. Validar que la solicitud existe y pertenece al tenant
    const reqRes = await query(
      'SELECT id, worker_id, status FROM employee_requests WHERE id = $1 AND company_id = $2',
      [requestId, companyId]
    );

    if (reqRes.rows.length === 0) {
      const err = new Error('Solicitud no encontrada.');
      err.statusCode = 404;
      err.errorCode = 'REQUEST_NOT_FOUND';
      throw err;
    }

    // 2. Generar ruta única en storage: {companyId}/requests/{requestId}/{uuid}-{filename}
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeFilename = `${crypto.randomUUID()}${ext}`;
    const storagePath = `${companyId}/requests/${requestId}/${safeFilename}`;

    // 3. Subir a Supabase Storage
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client no está configurado.');
    }

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      logger.logError('REQUEST_DOCS', `Error subiendo archivo: ${storagePath}`, uploadError);
      throw new Error(`Error al subir archivo: ${uploadError.message}`);
    }

    // 4. Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    // 5. Insertar registro en request_documents
    const result = await query(`
      INSERT INTO request_documents 
        (company_id, request_id, document_type, file_url, file_path, mime_type, file_size, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      companyId,
      requestId,
      documentType || this.#inferDocumentType(file.mimetype),
      publicUrl,
      storagePath,
      file.mimetype,
      file.size,
      uploadedBy
    ]);

    logger.logInfo('REQUEST_DOCS', `Archivo subido: ${file.originalname} → ${storagePath}`);
    return result.rows[0];
  }

  async uploadSignedDocument({ file, requestId, companyId, uploadedBy, observations, req = null }) {
    validateSignedRequestDocumentFile(file);

    const request = await this.getRequestForCompany(requestId, companyId);
    if (!request) {
      throw createHttpError(404, 'REQUEST_NOT_FOUND', 'Solicitud no encontrada.');
    }

    const timestamp = Date.now();
    const extension = getFileExtension(file) || path.extname(file.originalname || '') || '.pdf';
    const fileName = sanitizeFileName(`solicitud-firmada-${safeRequestBaseName(request)}-${timestamp}${extension}`);
    const filePath = buildWorkerStoragePath({
      companyId,
      workerId: request.resolved_worker_id,
      folder: 'requests/signed',
      fileName
    });

    const fileUrl = await uploadFile(file, BUCKET_NAME, filePath);
    const templateConfig = resolveRequestDocumentConfig(request.type_code, request.type_name);

    const document = await insertReturning({ query }, 'request_documents', {
      company_id: companyId,
      request_id: requestId,
      document_type: 'signed_request_document',
      file_url: fileUrl,
      file_path: filePath,
      mime_type: file.mimetype,
      file_size: file.size,
      status: 'signed_uploaded',
      observation: observations || null,
      uploaded_by: uploadedBy,
      metadata: {
        source: 'request_document_signed_upload',
        request_code: request.request_code || null,
        template_key: templateConfig.key,
        uploaded_at: new Date().toISOString()
      }
    });

    await this.#registerWorkerDocumentForRequest({
      request,
      companyId,
      requestId,
      requestDocument: document,
      documentType: 'signed_request_document',
      fileName,
      fileUrl,
      filePath,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      status: 'signed',
      uploadedBy,
      templateConfig,
      metadata: {
        source: 'request_document_signed_upload',
        uploaded_at: new Date().toISOString(),
        observations: observations || null
      }
    });

    await logAuditEvent({
      userId: uploadedBy,
      companyId,
      module: 'REQUESTS',
      action: 'SIGNED_REQUEST_DOCUMENT_UPLOADED',
      entity: 'request_documents',
      entityId: document.id || requestId,
      newData: {
        request_id: requestId,
        request_code: request.request_code || null,
        file_url: fileUrl,
        file_name: fileName
      },
      req: req || {}
    });

    return {
      request_id: requestId,
      request_code: request.request_code || null,
      worker_id: request.resolved_worker_id,
      signed_document: document,
      signed_file_url: fileUrl,
      file_url: fileUrl,
      file_name: fileName,
      file_path: filePath
    };
  }

  /**
   * Sube múltiples archivos para una solicitud.
   */
  async uploadMultipleDocuments({ files, requestId, companyId, uploadedBy, documentType }) {
    const results = [];
    for (const file of files) {
      const doc = await this.uploadDocument({
        file,
        requestId,
        companyId,
        uploadedBy,
        documentType
      });
      results.push(doc);
    }
    return results;
  }

  async #registerWorkerDocumentForRequest({
    request,
    companyId,
    requestId,
    requestDocument,
    documentType,
    fileName,
    fileUrl,
    filePath,
    mimeType,
    sizeBytes,
    status,
    uploadedBy,
    templateConfig,
    metadata = {}
  }) {
    if (!request?.resolved_worker_id) {
      return null;
    }

    return insertReturning({ query }, 'worker_documents', {
      worker_id: request.resolved_worker_id,
      company_id: companyId,
      document_type: documentType,
      title: buildWorkerDocumentTitle(documentType, request, templateConfig),
      file_name: fileName || fileNameFromPath(filePath),
      file_url: fileUrl,
      file_path: filePath,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      status,
      uploaded_by: uploadedBy,
      metadata: {
        ...metadata,
        request_id: requestId,
        request_document_id: requestDocument?.id || null,
        request_code: request.request_code || null,
        template_key: templateConfig?.key || null,
        template_title: templateConfig?.title || null
      }
    });
  }

  /**
   * Obtiene todos los documentos de una solicitud.
   */
  async getDocumentsByRequestId(requestId, companyId) {
    const result = await query(`
      SELECT 
        rd.*,
        CONCAT_WS(' ', u.first_name, u.last_name) AS uploaded_by_name
      FROM request_documents rd
      LEFT JOIN users u ON rd.uploaded_by = u.id
      WHERE rd.request_id = $1 AND rd.company_id = $2
      ORDER BY rd.created_at ASC
    `, [requestId, companyId]);

    return result.rows;
  }

  /**
   * Elimina un documento de una solicitud.
   */
  async deleteDocument(documentId, requestId, companyId, userId) {
    // 1. Buscar el documento
    const docRes = await query(
      'SELECT * FROM request_documents WHERE id = $1 AND request_id = $2 AND company_id = $3',
      [documentId, requestId, companyId]
    );

    if (docRes.rows.length === 0) {
      const err = new Error('Documento no encontrado.');
      err.statusCode = 404;
      err.errorCode = 'DOCUMENT_NOT_FOUND';
      throw err;
    }

    const doc = docRes.rows[0];

    // 2. Verificar que el usuario que sube es el dueño (o admin)
    // La verificación de permisos se hace en el controller/route

    // 3. Eliminar de Supabase Storage
    if (doc.file_path) {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { error: deleteError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([doc.file_path]);

        if (deleteError) {
          logger.logError('REQUEST_DOCS', `Error eliminando archivo de storage: ${doc.file_path}`, deleteError);
          // No lanzamos error, seguimos con la eliminación del registro
        }
      }
    }

    // 4. Eliminar registro de la BD
    await query('DELETE FROM request_documents WHERE id = $1', [documentId]);

    logger.logInfo('REQUEST_DOCS', `Documento eliminado: ${documentId} por usuario ${userId}`);
    return { id: documentId, deleted: true };
  }

  /**
   * Infiere el tipo de documento a partir del MIME type.
   */
  #inferDocumentType(mimeType) {
    if (!mimeType) return 'other';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.includes('word') || mimeType.includes('wordprocessing')) return 'word';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'excel';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'powerpoint';
    if (mimeType === 'text/plain') return 'text';
    return 'other';
  }
}

module.exports = new RequestDocumentService();
