const onboardingService = require('./services');

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'No se pudo procesar la solicitud.',
    code: error.errorCode || 'INTERNAL_SERVER_ERROR',
    error_code: error.errorCode || 'INTERNAL_SERVER_ERROR',
    errors: error.errors || undefined
  });
}

exports.suggestCredentials = async (req, res, next) => {
  try {
    const data = await onboardingService.suggestCredentials(req.body || {}, req);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    if (error.statusCode || error.errors) {
      return sendError(res, error);
    }
    next(error);
  }
};

exports.onboardWorker = async (req, res, next) => {
  try {
    const result = await onboardingService.onboardWorker(req.body || {}, req);
    res.status(201).json(result);
  } catch (error) {
    if (error.statusCode || error.errors) {
      return sendError(res, error);
    }
    next(error);
  }
};

exports.getOnboardingStatus = async (req, res, next) => {
  try {
    const workerId = req.params.workerId || req.params.id;
    const data = await onboardingService.getOnboardingStatus(workerId, req.tenantId);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    if (error.statusCode || error.errors) {
      return sendError(res, error);
    }
    next(error);
  }
};
