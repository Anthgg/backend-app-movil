const zod = require('zod');

const createAreaSchema = zod.object({
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  description: zod.string().optional().nullable(),
  status: zod.boolean().optional()
});

const updateAreaSchema = zod.object({
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150).optional(),
  description: zod.string().optional().nullable(),
  status: zod.boolean().optional()
});

const updateAreaStatusSchema = zod.object({
  status: zod.boolean({
    required_error: 'El estado es requerido',
    invalid_type_error: 'El estado debe ser booleano'
  })
});

function validateCreateArea(data) {
  const result = createAreaSchema.safeParse(data);
  if (!result.success) {
    return result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
  }
  return [];
}

function validateUpdateArea(data) {
  const result = updateAreaSchema.safeParse(data);
  if (!result.success) {
    return result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
  }
  return [];
}

function validateUpdateAreaStatus(data) {
  const result = updateAreaStatusSchema.safeParse(data);
  if (!result.success) {
    return result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
  }
  return [];
}

module.exports = {
  validateCreateArea,
  validateUpdateArea,
  validateUpdateAreaStatus
};
