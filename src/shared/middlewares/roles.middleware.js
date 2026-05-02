const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ success: false, message: 'Acceso denegado: roles no definidos' });
    }

    const hasRole = req.user.roles.some(role => allowedRoles.includes(role));

    // Si es ADMIN, tiene todos los roles de manera intrínseca
    if (req.user.roles.includes('ADMIN')) {
      return next();
    }

    if (!hasRole) {
      return res.status(403).json({ success: false, message: 'Acceso denegado: rol insuficiente' });
    }
    
    next();
  };
};

module.exports = { authorizeRoles };
