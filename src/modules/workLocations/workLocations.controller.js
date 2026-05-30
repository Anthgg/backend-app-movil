const service = require('./workLocations.service');
const {
  validateCreateWorkLocation,
  validateUpdateWorkLocation,
  validateUpdateWorkLocationStatus
} = require('./workLocations.validation');
const { createHttpError } = require('../../shared/utils/http-error');

function throwValidation(errors) {
  throw createHttpError(422, 'VALIDATION_ERROR', 'Errores de validación', errors);
}

async function getWorkLocations(req, res, next) {
  try {
    const data = await service.getWorkLocations(req.tenantId, req.query);
    res.json({ success: true, message: 'Lugares de trabajo obtenidos correctamente', data });
  } catch (error) {
    next(error.statusCode ? error : createHttpError(
      500,
      'CATALOG_FETCH_ERROR',
      'No se pudo obtener el catálogo',
      undefined,
      error.message
    ));
  }
}

async function getWorkLocationById(req, res, next) {
  try {
    const data = await service.getWorkLocationById(req.params.id, req.tenantId);
    res.json({ success: true, message: 'Lugar de trabajo obtenido correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function createWorkLocation(req, res, next) {
  try {
    const errors = validateCreateWorkLocation(req.body);
    if (errors.length > 0) throwValidation(errors);

    const data = await service.createWorkLocation(req.tenantId, req.body);
    res.status(201).json({ success: true, message: 'Lugar de trabajo creado correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function updateWorkLocation(req, res, next) {
  try {
    const errors = validateUpdateWorkLocation(req.body);
    if (errors.length > 0) throwValidation(errors);

    const data = await service.updateWorkLocation(req.params.id, req.tenantId, req.body);
    res.json({ success: true, message: 'Lugar de trabajo actualizado correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function updateWorkLocationStatus(req, res, next) {
  try {
    const errors = validateUpdateWorkLocationStatus(req.body);
    if (errors.length > 0) throwValidation(errors);

    const data = await service.updateWorkLocationStatus(req.params.id, req.tenantId, req.body.is_active ?? req.body.status);
    res.json({ success: true, message: 'Estado del lugar de trabajo actualizado', data });
  } catch (error) {
    next(error);
  }
}

async function deleteWorkLocation(req, res, next) {
  try {
    const data = await service.deleteWorkLocation(req.params.id, req.tenantId, req.user?.id);
    res.json({ success: true, message: 'Lugar de trabajo desactivado correctamente', data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWorkLocations,
  getWorkLocationById,
  createWorkLocation,
  updateWorkLocation,
  updateWorkLocationStatus,
  deleteWorkLocation
};
