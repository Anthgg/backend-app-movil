const { getSupabaseClient } = require('../../config/supabase');
const logger = require('./logger');

/**
 * Sube un archivo a Supabase Storage
 * @param {Object} file Objeto de Multer (buffer, mimetype, etc)
 * @param {string} bucket Nombre del bucket
 * @param {string} path Ruta dentro del bucket
 * @returns {Promise<string>} URL pública del archivo
 */
exports.uploadFile = async (file, bucket, path) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not initialized');

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      logger.logError('STORAGE', `Error uploading to ${bucket}/${path}`, error);
      // Evitar que el 404 interno de Supabase ("Bucket not found") pase como 404 de nuestra API.
      // Supabase devuelve statusCode como string "404", por lo que usamos parseInt o ==
      if (parseInt(error.statusCode) === 404) {
        error.statusCode = 500;
        error.message = `El bucket de almacenamiento '${bucket}' no está configurado o no existe`;
      }
      throw error;
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
