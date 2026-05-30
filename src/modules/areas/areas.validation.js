const zod = require('zod');

const UUID_OPTIONAL = zod.string().uuid('Debe ser un UUID valido').optional().nullable();

const createAreaSchema = zod.object({
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  description: zod.string().optional().nullable(),
  department_id: UUID_OPTIONAL,
  role_id: UUID_OPTIONAL,
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateAreaSchema = zod.object({
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150).optional(),
  description: zod.string().optional().nullable(),
  department_id: UUID_OPTIONAL,
  role_id: UUID_OPTIONAL,
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateAreaStatusSchema = zod.object({
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
}).refine((data) => data.status !== undefined || data.is_active !== undefined, {
  message: 'El estado es requerido',
  path: ['is_active']
});

function toErrors(result) {
  if (result.success) return [];
  return result.error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message
  }));
}

module.exports = {
  validateCreateArea: (data) => toErrors(createAreaSchema.safeParse(data)),
  validateUpdateArea: (data) => toErrors(updateAreaSchema.safeParse(data)),
  validateUpdateAreaStatus: (data) => toErrors(updateAreaStatusSchema.safeParse(data))
};
