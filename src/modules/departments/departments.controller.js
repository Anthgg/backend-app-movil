const departmentService = require('./departments.service');
const {
  validateCreateDepartment,
  validateUpdateDepartment,
  validateUpdateDepartmentStatus
} = require('./departments.validation');
const { createHttpError } = require('../../shared/utils/http-error');

function throwValidation(errors) {
  throw createHttpError(422, 'VALIDATION_ERROR', 'Errores de validación', errors);
}

async function getDepartments(req, res, next) {
  try {
    const departments = await departmentService.getDepartments(req.tenantId);
    res.json({ success: true, message: 'Departamentos obtenidos correctamente', data: departments });
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

async function getDepartmentById(req, res, next) {
  try {
    const department = await departmentService.getDepartmentById(req.params.id, req.tenantId);
    res.json({ success: true, message: 'Departamento obtenido correctamente', data: department });
  } catch (error) {
    next(error);
  }
}

async function createDepartment(req, res, next) {
  try {
    const validationErrors = validateCreateDepartment(req.body);
    if (validationErrors.length > 0) throwValidation(validationErrors);

    const department = await departmentService.createDepartment(req.tenantId, req.body);
    res.status(201).json({ success: true, message: 'Departamento creado correctamente', data: department });
  } catch (error) {
    next(error);
  }
}

async function updateDepartment(req, res, next) {
  try {
    const validationErrors = validateUpdateDepartment(req.body);
    if (validationErrors.length > 0) throwValidation(validationErrors);

    const department = await departmentService.updateDepartment(req.params.id, req.tenantId, req.body);
    res.json({ success: true, message: 'Departamento actualizado correctamente', data: department });
  } catch (error) {
    next(error);
  }
}

async function updateDepartmentStatus(req, res, next) {
  try {
    const validationErrors = validateUpdateDepartmentStatus(req.body);
    if (validationErrors.length > 0) throwValidation(validationErrors);

    const department = await departmentService.updateDepartmentStatus(
      req.params.id,
      req.tenantId,
      req.body.is_active ?? req.body.status
    );
    res.json({ success: true, message: 'Estado del departamento actualizado', data: department });
  } catch (error) {
    next(error);
  }
}

async function deleteDepartment(req, res, next) {
  try {
    const department = await departmentService.deleteDepartment(req.params.id, req.tenantId, req.user?.id);
    res.json({ success: true, message: 'Departamento desactivado correctamente', data: department });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  updateDepartmentStatus,
  deleteDepartment
};
