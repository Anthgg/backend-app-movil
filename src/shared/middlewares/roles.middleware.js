const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: roles no definidos',
        error_code: 'ROLE_REQUIRED',
        code: 'ROLE_REQUIRED',
        errorCode: 'ROLE_REQUIRED'
      });
    }

    const normalizedUserRoles = req.user.roles.map((role) => String(role).toUpperCase());
    const normalizedAllowedRoles = allowedRoles.map((role) => String(role).toUpperCase());
    const hasRole = normalizedUserRoles.some((role) => normalizedAllowedRoles.includes(role));

    // Si es ADMIN, tiene todos los roles de manera intrínseca
    if (normalizedUserRoles.includes('ADMIN')) {
      return next();
    }

    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: rol insuficiente',
        error_code: 'INSUFFICIENT_ROLE',
        code: 'INSUFFICIENT_ROLE',
        errorCode: 'INSUFFICIENT_ROLE'
      });
    }
    
    next();
  };
};

module.exports = { authorizeRoles };
