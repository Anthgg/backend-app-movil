const service = require('./workCrews.service');
const assignmentService = require('../../shared/services/worker-location-assignment.service');
const { createHttpError } = require('../../shared/utils/http-error');
const { isValidUUID } = require('../../utils/uuid.util');
const {
  validateCreateCrew,
  validateUpdateCrew,
  validateStatus,
  validateCrewLocation,
  validateCrewWorkers,
  validateMoveWorkerCrew,
  validateLocationAssignment
} = require('./workCrews.validation');

function throwValidation(errors) {
  throw createHttpError(422, 'VALIDATION_ERROR', 'Errores de validacion', errors);
}

function normalizeCrewPayload(body = {}) {
  const payload = { ...body };

  if (payload.supervisor_id === undefined && payload.supervisorId !== undefined) {
    payload.supervisor_id = payload.supervisorId;
  }
  if (payload.work_location_id === undefined && payload.workLocationId !== undefined) {
    payload.work_location_id = payload.workLocationId;
  }
  if (payload.is_active === undefined && payload.isActive !== undefined) {
    payload.is_active = payload.isActive;
  }

  return payload;
}

function assertSupervisorIdFormat(payload) {
  if (payload.supervisor_id !== undefined && !isValidUUID(payload.supervisor_id)) {
    throw createHttpError(400, 'INVALID_SUPERVISOR_ID', 'supervisor_id invalido. Debe ser un UUID valido.', [
      { field: 'supervisor_id', message: 'supervisor_id invalido. Debe ser un UUID valido.' }
    ]);
  }
}

function unwrapCrewResult(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'data')) {
    return {
      data: result.data,
      warnings: result.warnings || []
    };
  }

  return { data: result, warnings: [] };
}

async function getWorkCrews(req, res, next) {
  try {
    const data = await service.getWorkCrews(req.tenantId, req.query, req.user);
    res.json({ success: true, message: 'Cuadrillas obtenidas correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function getWorkCrewById(req, res, next) {
  try {
    const data = await service.getCrewById(req.params.id, req.tenantId, req.user);
    res.json({ success: true, message: 'Cuadrilla obtenida correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function createWorkCrew(req, res, next) {
  try {
    const payload = normalizeCrewPayload(req.body);
    assertSupervisorIdFormat(payload);
    const errors = validateCreateCrew(payload);
    if (errors.length) throwValidation(errors);
    const result = unwrapCrewResult(await service.createCrew(req.tenantId, payload, req.user));
    res.status(201).json({
      success: true,
      message: 'Cuadrilla creada correctamente',
      data: result.data,
      warnings: result.warnings
    });
  } catch (error) {
    next(error);
  }
}

async function updateWorkCrew(req, res, next) {
  try {
    const payload = normalizeCrewPayload(req.body);
    assertSupervisorIdFormat(payload);
    const errors = validateUpdateCrew(payload);
    if (errors.length) throwValidation(errors);
    const result = unwrapCrewResult(await service.updateCrew(req.params.id, req.tenantId, payload, req.user));
    res.json({
      success: true,
      message: 'Cuadrilla actualizada correctamente',
      data: result.data,
      warnings: result.warnings
    });
  } catch (error) {
    next(error);
  }
}

async function updateWorkCrewStatus(req, res, next) {
  try {
    const errors = validateStatus(req.body);
    if (errors.length) throwValidation(errors);
    const isActive = req.body.is_active !== undefined ? req.body.is_active : req.body.status;
    const data = await service.updateCrewStatus(req.params.id, req.tenantId, isActive, req.user);
    res.json({ success: true, message: 'Estado de cuadrilla actualizado', data });
  } catch (error) {
    next(error);
  }
}

async function updateWorkCrewLocation(req, res, next) {
  try {
    const errors = validateCrewLocation(req.body);
    if (errors.length) throwValidation(errors);
    const data = await service.updateCrewWorkLocation(req.params.id, req.tenantId, req.body, req.user);
    res.json({ success: true, message: 'Obra principal de cuadrilla actualizada', data });
  } catch (error) {
    next(error);
  }
}

async function addWorkersToCrew(req, res, next) {
  try {
    const errors = validateCrewWorkers(req.body);
    if (errors.length) throwValidation(errors);
    const workerIds = req.body.worker_ids || [req.body.worker_id];
    const data = await service.addWorkersToCrew(req.params.id, req.tenantId, workerIds, req.user, req.body.reason || null);
    res.status(201).json({ success: true, message: 'Trabajadores asignados a la cuadrilla', data });
  } catch (error) {
    next(error);
  }
}

async function getCrewWorkers(req, res, next) {
  try {
    const data = await service.getCrewWorkers(req.params.id, req.tenantId, req.user);
    res.json({ success: true, message: 'Trabajadores de cuadrilla obtenidos correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function removeWorkerFromCrew(req, res, next) {
  try {
    const data = await service.removeWorkerFromCrew(req.params.id, req.params.workerId, req.tenantId, req.user, req.body?.reason || null);
    res.json({ success: true, message: 'Trabajador retirado de la cuadrilla', data });
  } catch (error) {
    next(error);
  }
}

async function moveWorkerCrew(req, res, next) {
  try {
    const errors = validateMoveWorkerCrew(req.body);
    if (errors.length) throwValidation(errors);
    const data = await service.moveWorkerToCrew(req.params.workerId, req.tenantId, req.body.crew_id, req.user, req.body.reason || null);
    res.json({ success: true, message: 'Trabajador movido de cuadrilla correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function createWorkerLocationAssignment(req, res, next) {
  try {
    const errors = validateLocationAssignment(req.body);
    if (errors.length) throwValidation(errors);
    await assignmentService.assertCanManageWorkerAssignment(req.user, req.params.workerId, req.tenantId);
    const data = await assignmentService.createWorkerLocationAssignment(req.params.workerId, req.tenantId, req.body, req.user.id);
    res.status(201).json({ success: true, message: 'Asignacion de ubicacion registrada correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function getActiveWorkerLocation(req, res, next) {
  try {
    await assignmentService.assertCanViewWorkerLocation(req.user, req.params.workerId, req.tenantId);
    const data = await assignmentService.getActiveWorkLocationForWorker(req.params.workerId, req.tenantId, req.query.date);
    res.json({ success: true, message: 'Ubicacion activa obtenida correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function getWorkerLocationHistory(req, res, next) {
  try {
    await assignmentService.assertCanManageWorkerAssignment(req.user, req.params.workerId, req.tenantId);
    const data = await assignmentService.getWorkerAssignmentHistory(req.params.workerId, req.tenantId);
    res.json({ success: true, message: 'Historial de asignaciones obtenido correctamente', data });
  } catch (error) {
    next(error);
  }
}

async function cancelWorkerLocationAssignment(req, res, next) {
  try {
    const data = await assignmentService.cancelWorkerLocationAssignment(req.params.id, req.tenantId, req.user, req.body?.reason || null);
    res.json({ success: true, message: 'Asignacion cancelada correctamente', data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWorkCrews,
  getWorkCrewById,
  createWorkCrew,
  updateWorkCrew,
  updateWorkCrewStatus,
  updateWorkCrewLocation,
  addWorkersToCrew,
  getCrewWorkers,
  removeWorkerFromCrew,
  moveWorkerCrew,
  createWorkerLocationAssignment,
  getActiveWorkerLocation,
  getWorkerLocationHistory,
  cancelWorkerLocationAssignment
};
