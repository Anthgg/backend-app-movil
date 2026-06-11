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

module.exports = { getAbsoluteUrl };
