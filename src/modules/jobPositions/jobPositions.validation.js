const zod = require('zod');

const uuidSchema = zod.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Formato UUID inválido');

const createJobPositionSchema = zod.object({
  area_id: uuidSchema,
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  description: zod.string().optional().nullable(),
  level: zod.number().int().min(1).optional().nullable(),
  default_role_id: uuidSchema.optional().nullable(),
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateJobPositionSchema = zod.object({
  area_id: uuidSchema.optional(),
  name: zod.string().min(2).max(150).optional(),
  description: zod.string().optional().nullable(),
  level: zod.number().int().min(1).optional().nullable(),
  default_role_id: uuidSchema.optional().nullable(),
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateJobPositionStatusSchema = zod.object({
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
}).refine((data) => data.status !== undefined || data.is_active !== undefined, {
  message: 'El estado es requerido',
  path: ['is_active']
});

function validateCreateJobPosition(data) {
  const result = createJobPositionSchema.safeParse(data);
  if (!result.success) {
    return result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
  }
  return [];
}

function validateUpdateJobPosition(data) {
  const result = updateJobPositionSchema.safeParse(data);
  if (!result.success) {
    return result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
  }
  return [];
}

function validateUpdateJobPositionStatus(data) {
  const result = updateJobPositionStatusSchema.safeParse(data);
  if (!result.success) {
    return result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message
    }));
  }
  return [];
}

module.exports = {
  validateCreateJobPosition,
  validateUpdateJobPosition,
  validateUpdateJobPositionStatus
};
