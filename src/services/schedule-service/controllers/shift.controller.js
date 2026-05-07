const shiftRepository = require('../repositories/shift.repository');
const { getWorkerIdFromUserId } = require('../../attendance-service/services/utils.service');

exports.getShifts = async (req, res, next) => {
  try {
    const shifts = await shiftRepository.getAll(req.tenantId);
    res.json({ success: true, data: shifts });
  } catch (error) {
    next(error);
  }
};

exports.getShiftById = async (req, res, next) => {
  try {
    const shift = await shiftRepository.getById(req.params.id, req.tenantId);
    if (!shift) return res.status(404).json({ success: false, message: 'Turno no encontrado' });
    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.createShift = async (req, res, next) => {
  try {
    const shift = await shiftRepository.create(req.tenantId, req.body);
    res.status(201).json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.updateShift = async (req, res, next) => {
  try {
    const shift = await shiftRepository.update(req.params.id, req.tenantId, req.body);
    if (!shift) return res.status(404).json({ success: false, message: 'Turno no encontrado' });
    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.deleteShift = async (req, res, next) => {
  try {
    const deleted = await shiftRepository.delete(req.params.id, req.tenantId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Turno no encontrado' });
    res.json({ success: true, message: 'Turno eliminado correctamente' });
  } catch (error) {
    next(error);
  }
};

exports.assignShift = async (req, res, next) => {
  try {
    const { workerId, shiftId } = req.body;
    const updatedWorker = await shiftRepository.assignToWorker(workerId || req.params.id, shiftId, req.tenantId);
    res.json({ success: true, data: updatedWorker });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerShift = async (req, res, next) => {
  try {
    const workerId = req.params.id;
    const shift = await shiftRepository.getWorkerShift(workerId, req.tenantId);
    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.getMyShift = async (req, res, next) => {
  try {
    const workerId = await getWorkerIdFromUserId(req.user.id, req.tenantId);
    const shift = await shiftRepository.getWorkerShift(workerId, req.tenantId);
    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};
