const zod = require('zod');

const createDepartmentSchema = zod.object({
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  description: zod.string().optional().nullable(),
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateDepartmentSchema = zod.object({
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150).optional(),
  description: zod.string().optional().nullable(),
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
});

const updateDepartmentStatusSchema = zod.object({
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
}).refine((data) => data.status !== undefined || data.is_active !== undefined, {
  message: 'El estado es requerido',
  path: ['is_active']
});

function toErrors(result) {
  if (result.success) return [];
  return result.error.errors.map((err) => ({ field: err.path.join('.'), message: err.message }));
}

module.exports = {
  validateCreateDepartment: (data) => toErrors(createDepartmentSchema.safeParse(data)),
  validateUpdateDepartment: (data) => toErrors(updateDepartmentSchema.safeParse(data)),
  validateUpdateDepartmentStatus: (data) => toErrors(updateDepartmentStatusSchema.safeParse(data))
};
