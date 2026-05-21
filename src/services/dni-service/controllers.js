const dniService = require('./services');

exports.lookupDni = async (req, res, next) => {
  try {
    const dni = String(req.params.dni || '').trim();
    const data = await dniService.lookupDni(dni, req.user.id, req);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'No se encontraron datos para el DNI ingresado.'
      });
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    if (error.errors) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
        code: error.errorCode,
        errors: error.errors
      });
    }
    next(error);
  }
};
