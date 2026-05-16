const multer = require('multer');

// Tipos MIME permitidos para documentos de solicitud
const ALLOWED_MIME_TYPES = new Set([
  // Imágenes
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  // PDF
  'application/pdf',
  // Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // PowerPoint
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Texto plano
  'text/plain',
  // Genérico (algunos dispositivos envían esto)
  'application/octet-stream'
]);

const fileFilter = (req, file, cb) => {
  const mimeType = String(file.mimetype || '').toLowerCase();

  if (ALLOWED_MIME_TYPES.has(mimeType)) {
    cb(null, true);
  } else {
    const error = new Error(
      `Tipo de archivo no permitido: ${file.originalname} (${mimeType}). ` +
      'Se aceptan: imágenes (JPG, PNG, WebP, GIF), PDF, Word, Excel, PowerPoint y texto plano.'
    );
    error.statusCode = 415;
    error.errorCode = 'UNSUPPORTED_FILE_TYPE';
    cb(error, false);
  }
};

/**
 * Middleware de Multer para subir documentos de solicitudes.
 * - Almacena en memoria (buffer) para luego subir a Supabase Storage.
 * - Máximo 5 archivos simultáneos.
 * - Tamaño máximo por archivo: 10MB.
 * - Campo del formulario: "documents"
 */
const uploadRequestDocs = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB por archivo
    files: 5                     // Máximo 5 archivos por request
  },
  fileFilter
});

module.exports = { uploadRequestDocs };
