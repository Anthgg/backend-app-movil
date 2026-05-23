const zod = require('zod');

const createRoleSchema = zod.object({
  name: zod.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(80),
  code: zod.string().trim().min(2, 'El codigo debe tener al menos 2 caracteres').max(50).optional(),
  description: zod.string().optional().nullable(),
  is_system_role: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateRoleSchema = zod.object({
  name: zod.string().trim().min(2).max(80).optional(),
  code: zod.string().trim().min(2).max(50).optional(),
  description: zod.string().optional().nullable(),
  is_system_role: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateRoleStatusSchema = zod.object({
  is_active: zod.boolean({
    required_error: 'El estado es requerido',
    invalid_type_error: 'El estado debe ser booleano'
  })
});

function formatErrors(result) {
  if (result.success) return [];
  return result.error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message
  }));
}

module.exports = {
  validateCreateRole: (data) => formatErrors(createRoleSchema.safeParse(data)),
  validateUpdateRole: (data) => formatErrors(updateRoleSchema.safeParse(data)),
  validateUpdateRoleStatus: (data) => formatErrors(updateRoleStatusSchema.safeParse(data))
};
