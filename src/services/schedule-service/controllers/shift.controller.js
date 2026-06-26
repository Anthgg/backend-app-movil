const scheduleService = require('../services/laborSchedule.service');
const { getPublicUploadUrl } = require('../../../shared/utils/url.utils');

function getTargetDate(req) {
  return req.query.date || req.query.target_date || req.body?.date || req.body?.target_date || null;
}

function setNoStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

function sendObjectContract(res, data) {
  const objectData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  res.json({
    success: true,
    data: objectData,
    ...objectData
  });
}

function normalizeProfilePhotoUrl(req, value) {
  if (!value) {
    return null;
  }

  const absoluteUrl = getPublicUploadUrl(req, value);
  if (absoluteUrl) {
    return absoluteUrl;
  }

  return String(value).startsWith('http://') || String(value).startsWith('https://')
    ? value
    : null;
}

function normalizeAttendanceSummaryRecord(req, record) {
  const profilePhotoUrl = normalizeProfilePhotoUrl(req, record.profilePhotoUrl);
  return {
    ...record,
    profilePhotoUrl
  };
}

function sendScheduleError(res, error) {
  const code = error.errorCode || 'SCHEDULE_ERROR';
  return res.status(error.statusCode || 500).json({
    success: false,
    code,
    error_code: code,
    errorCode: code,
    message: error.message,
    details: error.details || {},
    error: {
      code,
      details: error.details || {}
    }
  });
}

exports.getPolicy = async (req, res, next) => {
  try {
    setNoStore(res);
    const policy = await scheduleService.getPolicy(req.tenantId);
    sendObjectContract(res, scheduleService.serializePolicy(policy) || {});
  } catch (error) {
    next(error);
  }
};

exports.updatePolicy = async (req, res, next) => {
  try {
    setNoStore(res);
    const policy = await scheduleService.updatePolicy(req.tenantId, req.body, req.user.id, req);
    sendObjectContract(res, scheduleService.serializePolicy(policy) || {});
  } catch (error) {
    next(error);
  }
};

exports.getShifts = async (req, res, next) => {
  try {
    setNoStore(res);
    const shifts = await scheduleService.listShifts(req.tenantId, req.query);
    res.json({ success: true, data: shifts });
  } catch (error) {
    next(error);
  }
};

exports.getShiftById = async (req, res, next) => {
  try {
    setNoStore(res);
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
    setNoStore(res);
    const shift = await scheduleService.createShift(req.tenantId, req.body, req.user.id, req);
    res.status(201).json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.updateShift = async (req, res, next) => {
  try {
    setNoStore(res);
    const shift = await scheduleService.updateShift(req.tenantId, req.params.id, req.body, req.user.id, req);
    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.deleteShift = async (req, res, next) => {
  try {
    setNoStore(res);
    await scheduleService.deleteShift(req.tenantId, req.params.id, req.user.id, req);
    res.json({ success: true, message: 'Turno desactivado correctamente' });
  } catch (error) {
    next(error);
  }
};

exports.assignShift = async (req, res, next) => {
  try {
    setNoStore(res);
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

exports.updateAssignment = async (req, res, next) => {
  try {
    setNoStore(res);
    const assignment = await scheduleService.updateAssignment(
      req.tenantId,
      req.params.id,
      req.body,
      req.user.id,
      req
    );
    res.json({ success: true, data: assignment });
  } catch (error) {
    if (error?.errorCode === 'SCHEDULE_ASSIGNMENT_OVERLAP') {
      return sendScheduleError(res, error);
    }
    next(error);
  }
};

exports.getAssignments = async (req, res, next) => {
  try {
    setNoStore(res);
    const assignments = await scheduleService.listAssignments(req.tenantId, req.query);
    res.json({ success: true, data: assignments });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerShift = async (req, res, next) => {
  try {
    setNoStore(res);
    const schedule = await scheduleService.getWorkerSchedule(req.tenantId, req.params.id, getTargetDate(req));
    res.json({ success: true, data: schedule.shift, schedule });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerSchedule = async (req, res, next) => {
  try {
    setNoStore(res);
    const schedule = await scheduleService.getWorkerSchedule(req.tenantId, req.params.id, getTargetDate(req));
    res.json({ success: true, data: schedule });
  } catch (error) {
    next(error);
  }
};

exports.getMyShift = async (req, res, next) => {
  try {
    setNoStore(res);
    const schedule = await scheduleService.getMySchedule(req.tenantId, req.user.id, getTargetDate(req));
    res.json({ success: true, data: schedule?.shift || null, schedule });
  } catch (error) {
    next(error);
  }
};

exports.getMySchedule = async (req, res, next) => {
  try {
    setNoStore(res);
    const schedule = await scheduleService.getMySchedule(req.tenantId, req.user.id, getTargetDate(req));
    res.json({ success: true, data: schedule });
  } catch (error) {
    next(error);
  }
};

exports.getAttendanceSummary = async (req, res, next) => {
  try {
    setNoStore(res);
    const summary = await scheduleService.getAttendanceSummary(req.tenantId, req.query);
    const records = summary.records.map((record) => normalizeAttendanceSummaryRecord(req, record));
    res.json({
      success: true,
      data: records,
      records,
      calendarRecords: records,
      calendar_records: records,
      recordsByDate: summary.recordsByDate || summary.records_by_date || {},
      records_by_date: summary.records_by_date || summary.recordsByDate || {},
      calendarByDate: summary.calendarByDate || summary.calendar_by_date || summary.recordsByDate || {},
      calendar_by_date: summary.calendar_by_date || summary.calendarByDate || summary.records_by_date || {},
      summary: {
        ...summary,
        records
      },
      meta: {
        start_date: summary.start_date,
        end_date: summary.end_date,
        total: records.length
      }
    });
  } catch (error) {
    next(error);
  }
};




exports.setRestDay = async (req, res, next) => {
  try {
    setNoStore(res);
    const body = req.body || {};
    const workerId = req.params.workerId || body.worker_id || body.workerId;
    const date = body.date || body.start_date || body.startDate || body.effective_from || body.effectiveFrom;
    const type = body.type || body.rest_day_type || body.restDayType || 'manual';
    const dayOfWeek = body.day_of_week
      ?? body.dayOfWeek
      ?? body.fixed_rest_day_of_week
      ?? body.fixedRestDayOfWeek
      ?? null;

    if (!workerId) {
      return res.status(400).json({ success: false, message: 'worker_id es obligatorio' });
    }

    const restDay = await scheduleService.setRestDay(
      req.tenantId,
      workerId,
      date,
      type,
      dayOfWeek
    );
    res.json({
      success: true,
      data: restDay,
      message: 'Dia de descanso configurado correctamente'
    });
  } catch (error) {
    next(error);
  }
};

exports.removeRestDay = async (req, res, next) => {
  try {
    setNoStore(res);
    const body = req.body || {};
    const workerId = req.params.workerId || body.worker_id || body.workerId;
    const date = body.date || body.rest_date || body.restDate;
    if (!workerId || !date) {
      return res.status(400).json({ success: false, message: 'worker_id y date son obligatorios' });
    }

    const result = await scheduleService.removeRestDay(req.tenantId, workerId, date);
    res.json({ success: true, data: result, message: 'Dia de descanso removido correctamente' });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/schedule/workers/:workerId/rest-days
 * Returns materialized rest days for a worker in a date range.
 * Query params: start_date, end_date (optional, defaults to current month)
 */
exports.getWorkerRestDays = async (req, res, next) => {
  try {
    const scheduleService = require('../services/laborSchedule.service');
    setNoStore(res);

    const workerId = req.params.workerId;
    const { start_date, end_date } = req.query;

    if (!workerId) {
      return res.status(400).json({ success: false, message: 'workerId es obligatorio' });
    }

    const data = await scheduleService.getWorkerRestDays(
      req.tenantId,
      workerId,
      start_date || null,
      end_date || null
    );

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};


