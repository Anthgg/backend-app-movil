const zod = require('zod');

const UUID_REQUIRED = zod.string().uuid('Debe ser un UUID valido');
const UUID_OPTIONAL = zod.string().uuid('Debe ser un UUID valido').optional().nullable();

const baseSchema = {
  sede_id: UUID_OPTIONAL,
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  description: zod.string().optional().nullable(),
  address: zod.string().min(3, 'La direccion es obligatoria'),
  company_id: UUID_OPTIONAL,
  department_id: UUID_OPTIONAL,
  province_id: UUID_OPTIONAL,
  district_id: UUID_OPTIONAL,
  geographic_department_id: UUID_OPTIONAL,
  geographic_province_id: UUID_OPTIONAL,
  geographic_district_id: UUID_OPTIONAL,
  latitude: zod.coerce.number().min(-90).max(90),
  longitude: zod.coerce.number().min(-180).max(180),
  allowed_radius_meters: zod.coerce.number().int().min(1).max(10000).optional(),
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
};

function hasCoordinatePair(data) {
  return (data.latitude === undefined || data.latitude === null) === (data.longitude === undefined || data.longitude === null);
}

const createWorkLocationSchema = zod.object(baseSchema)
.refine((data) => data.geographic_department_id || data.department_id, {
  message: 'El departamento es requerido',
  path: ['department_id']
})
.refine((data) => data.geographic_province_id || data.province_id, {
  message: 'La provincia es requerida',
  path: ['province_id']
})
.refine((data) => data.geographic_district_id || data.district_id, {
  message: 'El distrito es requerido',
  path: ['district_id']
})
.refine(hasCoordinatePair, {
  message: 'Latitude y longitude deben enviarse juntas',
  path: ['latitude']
});
const updateWorkLocationSchema = zod.object({
  ...baseSchema,
  name: baseSchema.name.optional(),
  address: baseSchema.address.optional(),
  latitude: zod.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: zod.coerce.number().min(-180).max(180).optional().nullable()
}).refine(hasCoordinatePair, {
  message: 'Latitude y longitude deben enviarse juntas',
  path: ['latitude']
});

const updateWorkLocationStatusSchema = zod.object({
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
  validateCreateWorkLocation: (data) => toErrors(createWorkLocationSchema.safeParse(data)),
  validateUpdateWorkLocation: (data) => toErrors(updateWorkLocationSchema.safeParse(data)),
  validateUpdateWorkLocationStatus: (data) => toErrors(updateWorkLocationStatusSchema.safeParse(data))
};
