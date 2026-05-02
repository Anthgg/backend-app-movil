const tenantMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
  }

  // Eliminar cualquier company_id malicioso enviado por el body/query
  if (req.body && req.body.company_id) {
      delete req.body.company_id;
  }
  if (req.query && req.query.company_id) {
      delete req.query.company_id;
  }

  // Si no es ADMIN GLOBAL (requiere permiso global especial, por ahora limitamos todos a su propia empresa)
  // Inyectar el company_id del usuario actual
  req.tenantId = req.user.company_id;
  
  if (!req.tenantId) {
      return res.status(403).json({ success: false, message: 'Usuario no tiene empresa asignada. Comuníquese con soporte.' });
  }

  next();
};

module.exports = { tenantMiddleware };
