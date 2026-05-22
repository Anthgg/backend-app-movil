const createWorkerService = require('./createWorker.service');

async function createWorker(req, res, next) {
  try {
    const data = await createWorkerService.createWorkerTransaction(req.body, req.tenantId, req.user.id);
    res.status(201).json({
      success: true,
      message: 'Registro creado correctamente',
      data
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createWorker
};
