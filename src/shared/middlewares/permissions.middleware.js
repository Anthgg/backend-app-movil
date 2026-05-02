const requirePermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions) {
      return res.status(403).json({ success: false, message: 'Acceso denegado: sin permisos definidos' });
    }

    // ADMIN tiene todos los permisos
    if (req.user.roles && req.user.roles.includes('ADMIN')) {
      return next();
    }

    const hasPermission = req.user.permissions.includes(requiredPermission);

    if (!hasPermission) {
      return res.status(403).json({ success: false, message: `Acceso denegado: falta el permiso [${requiredPermission}]` });
    }
    
    next();
  };
};

module.exports = { requirePermission };
