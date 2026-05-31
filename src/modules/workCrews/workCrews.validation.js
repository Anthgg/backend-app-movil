const zod = require('zod');

const UUID = zod.string().uuid('Debe ser un UUID valido');
const optionalText = zod.string().trim().optional().nullable();

const crewSchema = zod.object({
  name: zod.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(150),
  description: optionalText,
  supervisor_id: UUID,
  work_location_id: UUID,
  is_active: zod.boolean().optional(),
  status: zod.boolean().optional()
});

const updateCrewSchema = crewSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: 'Debe enviar al menos un campo para actualizar',
  path: ['body']
});

const statusSchema = zod.object({
  is_active: zod.boolean().optional(),
  status: zod.boolean().optional()
}).refine((data) => data.is_active !== undefined || data.status !== undefined, {
  message: 'El estado es requerido',
  path: ['is_active']
});

const crewLocationSchema = zod.object({
  work_location_id: UUID,
  reason: optionalText
});

const crewWorkersSchema = zod.object({
  worker_ids: zod.array(UUID).min(1, 'Debe enviar al menos un trabajador')
}).or(zod.object({
  worker_id: UUID
}));

const moveWorkerCrewSchema = zod.object({
  crew_id: UUID,
  reason: optionalText
});

const locationAssignmentSchema = zod.object({
  work_location_id: UUID,
  assignment_type: zod.enum(['temporary', 'permanent']).optional(),
  type: zod.enum(['temporary', 'permanent']).optional(),
  start_date: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional(),
  end_date: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional().nullable(),
  reason: optionalText,
  auto_return: zod.boolean().optional()
}).refine((data) => data.assignment_type || data.type, {
  message: 'El tipo de asignacion es requerido',
  path: ['assignment_type']
}).refine((data) => {
  const type = data.assignment_type || data.type;
  return type !== 'temporary' || Boolean(data.end_date);
}, {
  message: 'La asignacion temporal requiere fecha fin',
  path: ['end_date']
});

function toErrors(result) {
  if (result.success) return [];
  return result.error.errors.map((err) => ({ field: err.path.join('.'), message: err.message }));
}

module.exports = {
  validateCreateCrew: (data) => toErrors(crewSchema.safeParse(data)),
  validateUpdateCrew: (data) => toErrors(updateCrewSchema.safeParse(data)),
  validateStatus: (data) => toErrors(statusSchema.safeParse(data)),
  validateCrewLocation: (data) => toErrors(crewLocationSchema.safeParse(data)),
  validateCrewWorkers: (data) => toErrors(crewWorkersSchema.safeParse(data)),
  validateMoveWorkerCrew: (data) => toErrors(moveWorkerCrewSchema.safeParse(data)),
  validateLocationAssignment: (data) => toErrors(locationAssignmentSchema.safeParse(data))
};
