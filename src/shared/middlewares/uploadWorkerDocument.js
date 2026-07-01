const multer = require('multer');
const path = require('path');

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png'
]);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(mimeType) || !ALLOWED_EXTENSIONS.has(extension)) {
      const error = new Error('Formato no permitido. Adjunta un archivo PDF, PNG o JPG.');
      error.statusCode = 422;
      error.errorCode = 'UNSUPPORTED_DOCUMENT_FILE';
      error.details = {
        allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
        maxSizeBytes: MAX_FILE_SIZE_BYTES
      };
      return callback(error, false);
    }

    return callback(null, true);
  }
});

function uploadWorkerDocument(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      error.code = 'DOCUMENT_FILE_TOO_LARGE';
      error.statusCode = 422;
      error.errorCode = 'DOCUMENT_FILE_TOO_LARGE';
      error.message = 'El archivo supera el tamaño máximo de 10 MB.';
      error.details = { maxSizeBytes: MAX_FILE_SIZE_BYTES };
    } else if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      error.code = 'INVALID_DOCUMENT_FILE_FIELD';
      error.statusCode = 400;
      error.errorCode = 'INVALID_DOCUMENT_FILE_FIELD';
      error.message = 'Debes enviar un único archivo bajo el campo "file".';
      error.details = { field: 'file', maxFiles: 1 };
    }

    return next(error);
  });
}

module.exports = {
  uploadWorkerDocument,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS
};
