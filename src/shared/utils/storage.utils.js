const { getSupabaseClient } = require('../../config/supabase');
const logger = require('./logger');

const normalizeStorageError = (error, bucket) => {
  const statusCode = parseInt(error.statusCode || error.status, 10);

  if (statusCode === 404) {
    error.statusCode = 500;
    error.errorCode = 'STORAGE_BUCKET_NOT_FOUND';
    error.message = `El bucket de almacenamiento '${bucket}' no existe o no esta accesible. Ejecuta 'npm run storage:ensure' o crealo en Supabase.`;
  } else if (statusCode === 401 || statusCode === 403) {
    error.statusCode = 500;
    error.errorCode = 'STORAGE_PERMISSION_DENIED';
    error.message = 'La credencial de Supabase no tiene permisos de escritura en Storage. Configura SUPABASE_SERVICE_ROLE_KEY en el backend.';
  }

  return error;
};

/**
 * Sube un archivo a Supabase Storage
 * @param {Object} file Objeto de Multer (buffer, mimetype, etc)
 * @param {string} bucket Nombre del bucket
 * @param {string} path Ruta dentro del bucket
 * @returns {Promise<string>} URL publica del archivo
 */
exports.uploadFile = async (file, bucket, path) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      const error = new Error('SUPABASE_SERVICE_ROLE_KEY no configurada. El backend no puede subir archivos a Supabase Storage.');
      error.statusCode = 500;
      error.errorCode = 'SUPABASE_SERVICE_ROLE_MISSING';
      throw error;
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      logger.logError('STORAGE', `Error uploading to ${bucket}/${path}`, error);
      throw normalizeStorageError(error, bucket);
    }

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return publicUrl;
  } catch (error) {
    logger.logError('STORAGE', 'Failed to upload file', error);
    throw error;
  }
};

/**
 * Elimina un objeto de Supabase Storage. La operación es idempotente.
 */
exports.deleteFile = async (bucket, path) => {
  if (!path) return;

  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      const error = new Error('SUPABASE_SERVICE_ROLE_KEY no configurada. El backend no puede eliminar archivos de Supabase Storage.');
      error.statusCode = 500;
      error.errorCode = 'SUPABASE_SERVICE_ROLE_MISSING';
      throw error;
    }

    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error && parseInt(error.statusCode || error.status, 10) !== 404) {
      throw normalizeStorageError(error, bucket);
    }
  } catch (error) {
    logger.logError('STORAGE', `Failed to delete ${bucket}/${path}`, error);
    throw error;
  }
};
