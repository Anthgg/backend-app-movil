const zod = require('zod');

const accessSchema = zod.enum(['none', 'read', 'write', 'admin']);

const moduleAccessSchema = zod.object({
  key: zod.string().trim().min(2, 'El modulo es requerido').max(80),
  access: accessSchema
});

const createRoleSchema = zod.object({
  role: zod.string().trim().min(2, 'El identificador del rol es requerido').max(50).optional(),
  role_key: zod.string().trim().min(2, 'El identificador del rol es requerido').max(50).optional(),
  code: zod.string().trim().min(2, 'El codigo debe tener al menos 2 caracteres').max(50).optional(),
  label: zod.string().trim().min(2, 'El nombre visible es requerido').max(80).optional(),
  name: zod.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(80).optional(),
  description: zod.string().optional().nullable(),
  modules: zod.array(moduleAccessSchema).optional(),
  is_active: zod.boolean().optional()
}).superRefine((data, ctx) => {
  if (!data.role && !data.role_key && !data.code) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ['role'],
      message: 'El campo role o role_key es obligatorio'
    });
  }

  if (!data.label && !data.name) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ['label'],
      message: 'El label o nombre visible es obligatorio'
    });
  }
});

const updateRoleSchema = zod.object({
  role: zod.string().trim().min(2).max(50).optional(),
  role_key: zod.string().trim().min(2).max(50).optional(),
  code: zod.string().trim().min(2).max(50).optional(),
  label: zod.string().trim().min(2).max(80).optional(),
  name: zod.string().trim().min(2).max(80).optional(),
  description: zod.string().optional().nullable(),
  modules: zod.array(moduleAccessSchema).optional(),
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
