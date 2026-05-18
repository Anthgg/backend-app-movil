const { query } = require('../../../config/database');
const { getSupabaseClient } = require('../../../config/supabase');
const logger = require('../../../shared/utils/logger');
const path = require('path');
const crypto = require('crypto');

const BUCKET_NAME = 'request-documents';

class RequestTemplateService {
  /**
   * Obtiene todas las plantillas activas de una empresa
   */
  async listTemplates(companyId, includeInactive = false) {
    let sql = 'SELECT * FROM public.request_templates WHERE company_id = $1';
    const params = [companyId];

    if (!includeInactive) {
      sql += ' AND is_active = true';
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    return result.rows;
  }

  /**
   * Obtiene una plantilla por su ID
   */
  async getTemplateById(id, companyId) {
    const result = await query(
      'SELECT * FROM public.request_templates WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );

    if (result.rows.length === 0) {
      const err = new Error('Plantilla no encontrada.');
      err.statusCode = 404;
      err.errorCode = 'TEMPLATE_NOT_FOUND';
      throw err;
    }

    return result.rows[0];
  }

  /**
   * Crea una nueva plantilla (sube archivo y registra en base de datos)
   */
  async createTemplate({ file, name, description, companyId, userId }) {
    if (!file) {
      const err = new Error('El archivo de la plantilla es obligatorio.');
      err.statusCode = 400;
      err.errorCode = 'FILE_REQUIRED';
      throw err;
    }

    // 1. Generar ruta única en storage: {companyId}/templates/{uuid}-{filename}
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeFilename = `${crypto.randomUUID()}${ext}`;
    const storagePath = `${companyId}/templates/${safeFilename}`;

    // 2. Subir a Supabase Storage
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('El cliente de Supabase no está configurado.');
    }

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      logger.logError('REQUEST_TEMPLATES', `Error subiendo plantilla: ${storagePath}`, uploadError);
      throw new Error(`Error al subir plantilla a Storage: ${uploadError.message}`);
    }

    // 3. Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    // 4. Insertar en base de datos
    const result = await query(
      `INSERT INTO public.request_templates 
        (company_id, name, description, file_url, file_path, mime_type, file_size, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        companyId,
        name,
        description || null,
        publicUrl,
        storagePath,
        file.mimetype,
        file.size,
        userId
      ]
    );

    logger.logInfo('REQUEST_TEMPLATES', `Plantilla creada: '${name}' → ${storagePath}`);
    return result.rows[0];
  }

  /**
   * Actualiza los metadatos de una plantilla (y opcionalmente reemplaza el archivo en Storage)
   */
  async updateTemplate(id, companyId, { file, name, description, is_active, userId }) {
    // 1. Verificar que existe
    const template = await this.getTemplateById(id, companyId);

    let fileUrl = template.file_url;
    let filePath = template.file_path;
    let mimeType = template.mime_type;
    let fileSize = template.file_size;

    // 2. Si se envía un archivo nuevo, reemplazarlo
    if (file) {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('El cliente de Supabase no está configurado.');
      }

      // Eliminar el archivo antiguo del Storage si existía
      if (template.file_path) {
        await supabase.storage.from(BUCKET_NAME).remove([template.file_path]).catch(err => {
          logger.logError('REQUEST_TEMPLATES', `Error eliminando plantilla antigua: ${template.file_path}`, err);
        });
      }

      // Subir el nuevo archivo
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeFilename = `${crypto.randomUUID()}${ext}`;
      filePath = `${companyId}/templates/${safeFilename}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) {
        logger.logError('REQUEST_TEMPLATES', `Error subiendo plantilla de reemplazo: ${filePath}`, uploadError);
        throw new Error(`Error al subir nueva plantilla: ${uploadError.message}`);
      }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
      fileUrl = publicUrl;
      mimeType = file.mimetype;
      fileSize = file.size;
    }

    // 3. Actualizar en la base de datos
    const finalName = name || template.name;
    const finalDescription = description !== undefined ? description : template.description;
    const finalIsActive = is_active !== undefined ? is_active : template.is_active;

    const result = await query(
      `UPDATE public.request_templates 
       SET name = $1, description = $2, file_url = $3, file_path = $4, mime_type = $5, file_size = $6, is_active = $7, updated_at = NOW()
       WHERE id = $8 AND company_id = $9
       RETURNING *`,
      [
        finalName,
        finalDescription,
        fileUrl,
        filePath,
        mimeType,
        fileSize,
        finalIsActive,
        id,
        companyId
      ]
    );

    logger.logInfo('REQUEST_TEMPLATES', `Plantilla actualizada: ${id} por usuario ${userId}`);
    return result.rows[0];
  }

  /**
   * Desactiva lógicamente una plantilla
   */
  async deactivateTemplate(id, companyId, userId) {
    const result = await query(
      `UPDATE public.request_templates 
       SET is_active = false, updated_at = NOW() 
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      const err = new Error('Plantilla no encontrada.');
      err.statusCode = 404;
      err.errorCode = 'TEMPLATE_NOT_FOUND';
      throw err;
    }

    logger.logInfo('REQUEST_TEMPLATES', `Plantilla desactivada: ${id} por usuario ${userId}`);
    return result.rows[0];
  }
}

module.exports = new RequestTemplateService();
