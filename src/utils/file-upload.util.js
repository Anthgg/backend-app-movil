const multer = require('multer');
const path = require('path');

const MAX_SIGNED_CONTRACT_SIZE_BYTES = parseInt(process.env.SIGNED_CONTRACT_MAX_BYTES || '', 10) || 10 * 1024 * 1024;

const ALLOWED_SIGNED_CONTRACT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/x-png'
]);

const ALLOWED_SIGNED_CONTRACT_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

function sanitizeFileName(value) {
  const extension = path.extname(value || '').toLowerCase();
  const baseName = path.basename(value || 'documento', extension)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'documento';

  return `${baseName}${extension}`;
}

function getFileExtension(file = {}) {
  const originalExtension = path.extname(file.originalname || '').toLowerCase();
  if (ALLOWED_SIGNED_CONTRACT_EXTENSIONS.has(originalExtension)) {
    return originalExtension;
  }

  const mimeToExtension = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/pjpeg': '.jpg',
    'image/png': '.png',
    'image/x-png': '.png'
  };

  return mimeToExtension[String(file.mimetype || '').toLowerCase()] || '';
}

function validateSignedContractFile(file) {
  if (!file) {
    const error = new Error('El archivo del contrato firmado es obligatorio.');
    error.statusCode = 400;
    error.errorCode = 'SIGNED_CONTRACT_FILE_REQUIRED';
    throw error;
  }

  const mimeType = String(file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();

  if (!ALLOWED_SIGNED_CONTRACT_MIME_TYPES.has(mimeType) || !ALLOWED_SIGNED_CONTRACT_EXTENSIONS.has(extension)) {
    const error = new Error('Tipo de archivo no permitido. Se aceptan PDF, JPG y PNG.');
    error.statusCode = 415;
    error.errorCode = 'INVALID_FILE_TYPE';
    throw error;
  }

  if (file.size > MAX_SIGNED_CONTRACT_SIZE_BYTES) {
    const error = new Error('El archivo supera el tamaño máximo permitido.');
    error.statusCode = 413;
    error.errorCode = 'FILE_TOO_LARGE';
    throw error;
  }
}

function buildWorkerStoragePath({ companyId, workerId, folder, fileName }) {
  return `companies/${companyId}/workers/${workerId}/${folder}/${sanitizeFileName(fileName)}`;
}

const signedContractUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SIGNED_CONTRACT_SIZE_BYTES,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    try {
      validateSignedContractFile({
        ...file,
        size: file.size || 0
      });
      cb(null, true);
    } catch (error) {
      cb(error, false);
    }
  }
});

module.exports = {
  MAX_SIGNED_CONTRACT_SIZE_BYTES,
  sanitizeFileName,
  getFileExtension,
  validateSignedContractFile,
  buildWorkerStoragePath,
  signedContractUpload
};
