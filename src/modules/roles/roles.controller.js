const roleService = require('./roles.service');
const { validateCreateRole, validateUpdateRole, validateUpdateRoleStatus } = require('./roles.validation');

function throwValidation(errors) {
  if (errors.length === 0) return;
  const error = new Error('Errores de validacion');
  error.statusCode = 422;
  error.errorCode = 'VALIDATION_ERROR';
  error.errors = errors;
  throw error;
}

async function getRoles(req, res, next) {
  try {
    const roles = await roleService.getRoles(req.tenantId);
    res.json({
      success: true,
      message: 'Roles obtenidos correctamente',
      data: roles
    });
  } catch (error) {
    next(error);
  }
}

async function getRoleById(req, res, next) {
  try {
    const role = await roleService.getRoleById(req.params.id, req.tenantId);
    res.json({
      success: true,
      message: 'Rol obtenido correctamente',
      data: role
    });
  } catch (error) {
    next(error);
  }
}

async function createRole(req, res, next) {
  try {
    throwValidation(validateCreateRole(req.body));
    const role = await roleService.createRole(req.tenantId, req.body, req);
    res.status(201).json({
      success: true,
      message: 'Rol creado correctamente',
      data: role
    });
  } catch (error) {
    next(error);
  }
}

async function updateRole(req, res, next) {
  try {
    throwValidation(validateUpdateRole(req.body));
    const role = await roleService.updateRole(req.params.id, req.tenantId, req.body, req);
    res.json({
      success: true,
      message: 'Rol actualizado correctamente',
      data: role
    });
  } catch (error) {
    next(error);
  }
}

async function updateRoleStatus(req, res, next) {
  try {
    throwValidation(validateUpdateRoleStatus(req.body));
    const role = await roleService.updateRoleStatus(req.params.id, req.tenantId, req.body.is_active, req);
    res.json({
      success: true,
      message: 'Estado del rol actualizado',
      data: role
    });
  } catch (error) {
    next(error);
  }
}

async function deleteRole(req, res, next) {
  try {
    const role = await roleService.deleteRole(req.params.id, req.tenantId, req.user?.id, req);
    res.json({
      success: true,
      message: 'Rol eliminado correctamente',
      data: role
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  updateRoleStatus,
  deleteRole
};
