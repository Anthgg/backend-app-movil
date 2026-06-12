const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, '../../../uploads');

/**
 * Normaliza una ruta de archivo relativa a una URL absoluta
 * utilizando el protocolo y host de la solicitud actual.
 * 
 * @param {Object} req Objeto Request de Express
 * @param {string} relativePath Ruta relativa (ej: /uploads/profiles/photo.jpg)
 * @returns {string|null} URL absoluta o null si no se provee ruta
 */
function getAbsoluteUrl(req, relativePath) {
  if (!relativePath) return null;

  // Si ya es una URL absoluta, la retornamos tal cual
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  
  const protocol = req.protocol || 'http';
  const host = req.get('host');
  
  // Aseguramos que la ruta comience con una barra diagonal
  const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  
  return `${protocol}://${host}${cleanPath}`;
}

function extractUploadPath(value) {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.pathname.startsWith('/uploads/') ? parsed.pathname : value;
  } catch (_) {
    return String(value);
  }
}

function getUploadFilePath(uploadPath) {
  if (!uploadPath) return null;
  const normalized = uploadPath.startsWith('/') ? uploadPath : `/${uploadPath}`;
  if (!normalized.startsWith('/uploads/')) return null;

  const relative = normalized.replace(/^\/uploads\//, '').replace(/[/\\]+/g, path.sep);
  const absolute = path.resolve(UPLOADS_ROOT, relative);
  const root = path.resolve(UPLOADS_ROOT);

  if (!absolute.startsWith(root)) {
    return null;
  }

  return absolute;
}

function uploadExists(uploadPath) {
  const filePath = getUploadFilePath(uploadPath);
  return !!filePath && fs.existsSync(filePath);
}

function getPublicUploadUrl(req, storedValue) {
  const uploadPath = extractUploadPath(storedValue);
  if (!uploadPath) return null;

  if (String(uploadPath).startsWith('/uploads/') || String(uploadPath).startsWith('uploads/')) {
    return uploadExists(uploadPath) ? getAbsoluteUrl(req, uploadPath) : null;
  }

  if (String(storedValue).startsWith('http://') || String(storedValue).startsWith('https://')) {
    return storedValue;
  }

  return null;
}

module.exports = {
  getAbsoluteUrl,
  extractUploadPath,
  getUploadFilePath,
  uploadExists,
  getPublicUploadUrl
};
