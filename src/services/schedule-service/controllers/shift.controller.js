const scheduleService = require('../services/laborSchedule.service');

function getTargetDate(req) {
  return req.query.date || req.query.target_date || req.body?.date || req.body?.target_date || null;
}

exports.getPolicy = async (req, res, next) => {
  try {
    const policy = await scheduleService.getPolicy(req.tenantId);
    res.json({ success: true, data: policy });
  } catch (error) {
    next(error);
  }
};

exports.updatePolicy = async (req, res, next) => {
  try {
    const policy = await scheduleService.updatePolicy(req.tenantId, req.body, req.user.id, req);
    res.json({ success: true, data: policy });
  } catch (error) {
    next(error);
  }
};

exports.getShifts = async (req, res, next) => {
  try {
    const shifts = await scheduleService.listShifts(req.tenantId, req.query);
    res.json({ success: true, data: shifts });
  } catch (error) {
    next(error);
  }
};

exports.getShiftById = async (req, res, next) => {
  try {
    const shift = await scheduleService.getShift(req.tenantId, req.params.id, { includeInactive: true });
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Turno no encontrado', error_code: 'SHIFT_NOT_FOUND' });
    }

    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.createShift = async (req, res, next) => {
  try {
    const shift = await scheduleService.createShift(req.tenantId, req.body, req.user.id, req);
    res.status(201).json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.updateShift = async (req, res, next) => {
  try {
    const shift = await scheduleService.updateShift(req.tenantId, req.params.id, req.body, req.user.id, req);
    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.deleteShift = async (req, res, next) => {
  try {
    await scheduleService.deleteShift(req.tenantId, req.params.id, req.user.id, req);
    res.json({ success: true, message: 'Turno desactivado correctamente' });
  } catch (error) {
    next(error);
  }
};

exports.assignShift = async (req, res, next) => {
  try {
    const workerId = req.params.id || req.body.worker_id || req.body.workerId;
    const shiftId = req.body.shift_id || req.body.shiftId;
    if (!workerId || !shiftId) {
      return res.status(400).json({
        success: false,
        message: 'worker_id y shift_id son obligatorios',
        error_code: 'SHIFT_ASSIGNMENT_REQUIRED'
      });
    }

    const assignment = await scheduleService.assignShift(req.tenantId, workerId, shiftId, req.body, req.user.id, req);
    res.json({ success: true, data: assignment });
  } catch (error) {
    next(error);
  }
};

exports.createAssignment = exports.assignShift;

exports.getAssignments = async (req, res, next) => {
  try {
    const assignments = await scheduleService.listAssignments(req.tenantId, req.query);
    res.json({ success: true, data: assignments });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerShift = async (req, res, next) => {
  try {
    const schedule = await scheduleService.getWorkerSchedule(req.tenantId, req.params.id, getTargetDate(req));
    res.json({ success: true, data: schedule.shift, schedule });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerSchedule = async (req, res, next) => {
  try {
    const schedule = await scheduleService.getWorkerSchedule(req.tenantId, req.params.id, getTargetDate(req));
    res.json({ success: true, data: schedule });
  } catch (error) {
    next(error);
  }
};

exports.getMyShift = async (req, res, next) => {
  try {
    const schedule = await scheduleService.getMySchedule(req.tenantId, req.user.id, getTargetDate(req));
    res.json({ success: true, data: schedule?.shift || null, schedule });
  } catch (error) {
    next(error);
  }
};

exports.getMySchedule = async (req, res, next) => {
  try {
    const schedule = await scheduleService.getMySchedule(req.tenantId, req.user.id, getTargetDate(req));
    res.json({ success: true, data: schedule });
  } catch (error) {
    next(error);
  }
};

exports.getAttendanceSummary = async (req, res, next) => {
  try {
    const summary = await scheduleService.getAttendanceSummary(req.tenantId, req.query);
    res.json({
      success: true,
      data: summary.records,
      records: summary.records,
      summary,
      meta: {
        start_date: summary.start_date,
        end_date: summary.end_date,
        total: summary.records.length
      }
    });
  } catch (error) {
    next(error);
  }
};
