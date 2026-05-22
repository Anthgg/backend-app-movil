const jobPositionService = require('./jobPositions.service');
const { validateCreateJobPosition, validateUpdateJobPosition, validateUpdateJobPositionStatus } = require('./jobPositions.validation');

async function getJobPositions(req, res, next) {
  try {
    const positions = await jobPositionService.getJobPositions(req.tenantId);
    res.json({
      success: true,
      message: 'Puestos de trabajo obtenidos correctamente',
      data: positions
    });
  } catch (error) {
    next(error);
  }
}

async function getJobPositionsByArea(req, res, next) {
  try {
    const positions = await jobPositionService.getJobPositionsByArea(req.params.areaId, req.tenantId);
    res.json({
      success: true,
      message: 'Puestos de trabajo del área obtenidos correctamente',
      data: positions
    });
  } catch (error) {
    next(error);
  }
}

async function getJobPositionById(req, res, next) {
  try {
    const position = await jobPositionService.getJobPositionById(req.params.id, req.tenantId);
    res.json({
      success: true,
      message: 'Puesto de trabajo obtenido correctamente',
      data: position
    });
  } catch (error) {
    next(error);
  }
}

async function createJobPosition(req, res, next) {
  try {
    const validationErrors = validateCreateJobPosition(req.body);
    if (validationErrors.length > 0) {
      const error = new Error('Errores de validación');
      error.statusCode = 422;
      error.errorCode = 'VALIDATION_ERROR';
      error.errors = validationErrors;
      throw error;
    }

    const position = await jobPositionService.createJobPosition(req.tenantId, req.body);
    res.status(201).json({
      success: true,
      message: 'Puesto de trabajo creado correctamente',
      data: position
    });
  } catch (error) {
    next(error);
  }
}

async function updateJobPosition(req, res, next) {
  try {
    const validationErrors = validateUpdateJobPosition(req.body);
    if (validationErrors.length > 0) {
      const error = new Error('Errores de validación');
      error.statusCode = 422;
      error.errorCode = 'VALIDATION_ERROR';
      error.errors = validationErrors;
      throw error;
    }

    const position = await jobPositionService.updateJobPosition(req.params.id, req.tenantId, req.body);
    res.json({
      success: true,
      message: 'Puesto de trabajo actualizado correctamente',
      data: position
    });
  } catch (error) {
    next(error);
  }
}

async function updateJobPositionStatus(req, res, next) {
  try {
    const validationErrors = validateUpdateJobPositionStatus(req.body);
    if (validationErrors.length > 0) {
      const error = new Error('Errores de validación');
      error.statusCode = 422;
      error.errorCode = 'VALIDATION_ERROR';
      error.errors = validationErrors;
      throw error;
    }

    const position = await jobPositionService.updateJobPositionStatus(req.params.id, req.tenantId, req.body.status);
    res.json({
      success: true,
      message: 'Estado del puesto actualizado',
      data: position
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getJobPositions,
  getJobPositionsByArea,
  getJobPositionById,
  createJobPosition,
  updateJobPosition,
  updateJobPositionStatus
};
