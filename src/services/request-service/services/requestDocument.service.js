const { query } = require('../../../config/database');
const env = require('../../../config/env');
const { getSupabaseClient } = require('../../../config/supabase');
const logger = require('../../../shared/utils/logger');
const path = require('path');
const crypto = require('crypto');

const BUCKET_NAME = env.requestDocumentsBucket;

class RequestDocumentService {

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
