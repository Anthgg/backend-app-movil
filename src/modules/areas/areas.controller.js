const areaService = require('./areas.service');
const { validateCreateArea, validateUpdateArea, validateUpdateAreaStatus } = require('./areas.validation');

function throwValidation(errors) {
  const error = new Error('Errores de validación');
  error.statusCode = 422;
  error.errorCode = 'VALIDATION_ERROR';
  error.errors = errors;
  throw error;
}

async function getAreas(req, res, next) {
  try {
    const areas = await areaService.getAreas(req.tenantId);
    res.json({ success: true, message: 'Áreas obtenidas correctamente', data: areas });
  } catch (error) {
    next(error);
  }
}

async function getAreaById(req, res, next) {
  try {
    const area = await areaService.getAreaById(req.params.id, req.tenantId);
    res.json({ success: true, message: 'Área obtenida correctamente', data: area });
  } catch (error) {
    next(error);
  }
}

async function getAreasByDepartment(req, res, next) {
  try {
    const areas = await areaService.getAreasByDepartment(req.params.departmentId, req.tenantId);
    res.json({
      success: true,
      message: 'Áreas del departamento obtenidas correctamente',
      data: areas
    });
  } catch (error) {
    next(error);
  }
}

async function createArea(req, res, next) {
  try {
    const validationErrors = validateCreateArea(req.body);
    if (validationErrors.length > 0) throwValidation(validationErrors);

    const area = await areaService.createArea(req.tenantId, req.body);
    res.status(201).json({ success: true, message: 'Área creada correctamente', data: area });
  } catch (error) {
    next(error);
  }
}

async function updateArea(req, res, next) {
  try {
    const validationErrors = validateUpdateArea(req.body);
    if (validationErrors.length > 0) throwValidation(validationErrors);

    const area = await areaService.updateArea(req.params.id, req.tenantId, req.body);
    res.json({ success: true, message: 'Área actualizada correctamente', data: area });
  } catch (error) {
    next(error);
  }
}

async function updateAreaStatus(req, res, next) {
  try {
    const validationErrors = validateUpdateAreaStatus(req.body);
    if (validationErrors.length > 0) throwValidation(validationErrors);

    const area = await areaService.updateAreaStatus(req.params.id, req.tenantId, req.body.is_active ?? req.body.status);
    res.json({ success: true, message: 'Estado del área actualizado', data: area });
  } catch (error) {
    next(error);
  }
}

async function deleteArea(req, res, next) {
  try {
    const area = await areaService.deleteArea(req.params.id, req.tenantId, req.user?.id);
    res.json({ success: true, message: 'Área eliminada correctamente', data: area });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAreas,
  getAreaById,
  getAreasByDepartment,
  createArea,
  updateArea,
  updateAreaStatus,
  deleteArea
};
