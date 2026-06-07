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
})).or(zod.object({
  workerIds: zod.array(UUID).min(1, 'Debe enviar al menos un trabajador')
})).or(zod.object({
  workerId: UUID
}));

const moveWorkerCrewSchema = zod.object({
  crew_id: UUID.optional(),
  crewId: UUID.optional(),
  reason: optionalText
}).refine((data) => data.crew_id || data.crewId, {
  message: 'La cuadrilla destino es requerida',
  path: ['crew_id']
});

const reassignWorkerSchema = zod.object({
  target_work_location_id: UUID.optional(),
  targetWorkLocationId: UUID.optional(),
  work_location_id: UUID.optional(),
  workLocationId: UUID.optional(),
  target_crew_id: UUID.optional(),
  targetCrewId: UUID.optional(),
  crew_id: UUID.optional(),
  crewId: UUID.optional(),
  reason: optionalText,
  effective_date: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional(),
  effectiveDate: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional()
}).refine((data) => (
  data.target_work_location_id
  || data.targetWorkLocationId
  || data.work_location_id
  || data.workLocationId
  || data.target_crew_id
  || data.targetCrewId
  || data.crew_id
  || data.crewId
), {
  message: 'Debe indicar una obra o cuadrilla destino',
  path: ['targetWorkLocationId']
});

const locationAssignmentSchema = zod.object({
  work_location_id: UUID.optional(),
  workLocationId: UUID.optional(),
  assignment_type: zod.enum(['temporary', 'permanent']).optional(),
  assignmentType: zod.enum(['temporary', 'permanent']).optional(),
  type: zod.enum(['temporary', 'permanent']).optional(),
  start_date: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional(),
  startDate: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional(),
  end_date: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional().nullable(),
  endDate: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha YYYY-MM-DD').optional().nullable(),
  reason: optionalText,
  auto_return: zod.boolean().optional(),
  autoReturn: zod.boolean().optional()
}).refine((data) => data.work_location_id || data.workLocationId, {
  message: 'El lugar de trabajo es requerido',
  path: ['work_location_id']
}).refine((data) => data.assignment_type || data.assignmentType || data.type, {
  message: 'El tipo de asignacion es requerido',
  path: ['assignment_type']
}).refine((data) => {
  const type = data.assignment_type || data.assignmentType || data.type;
  return type !== 'temporary' || Boolean(data.end_date || data.endDate);
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
  validateReassignWorker: (data) => toErrors(reassignWorkerSchema.safeParse(data)),
  validateLocationAssignment: (data) => toErrors(locationAssignmentSchema.safeParse(data))
};
