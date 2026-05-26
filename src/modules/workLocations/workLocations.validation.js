const zod = require('zod');

const UUID_REQUIRED = zod.string().uuid('Debe ser un UUID valido');
const UUID_OPTIONAL = zod.string().uuid('Debe ser un UUID valido').optional().nullable();

const baseSchema = {
  sede_id: UUID_OPTIONAL,
  name: zod.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  address: zod.string().min(3, 'La direccion es obligatoria'),
  geographic_department_id: UUID_REQUIRED,
  geographic_province_id: UUID_REQUIRED,
  geographic_district_id: UUID_REQUIRED,
  latitude: zod.number().min(-90).max(90).optional().nullable(),
  longitude: zod.number().min(-180).max(180).optional().nullable(),
  allowed_radius_meters: zod.number().int().min(1).max(10000).optional(),
  status: zod.boolean().optional(),
  is_active: zod.boolean().optional()
};

function hasCoordinatePair(data) {
  return (data.latitude === undefined || data.latitude === null) === (data.longitude === undefined || data.longitude === null);
}

const createWorkLocationSchema = zod.object(baseSchema).refine(hasCoordinatePair, {
  message: 'Latitude y longitude deben enviarse juntas',
  path: ['latitude']
});
const updateWorkLocationSchema = zod.object({
  ...baseSchema,
  name: baseSchema.name.optional(),
  address: baseSchema.address.optional(),
  geographic_department_id: UUID_OPTIONAL,
  geographic_province_id: UUID_OPTIONAL,
  geographic_district_id: UUID_OPTIONAL
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
