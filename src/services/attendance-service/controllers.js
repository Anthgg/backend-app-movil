const { query } = require('../../config/database');
const logger = require('../../shared/utils/logger');
const { logAudit } = require('../../shared/utils/audit');
const { getWorkerIdFromUserId } = require('./services/utils.service');
const { validateDevice, validateGps } = require('./services/validation.service');
const { findActiveCheckIn, createCheckIn, updateCheckOut } = require('./services/check.service');
const { getHistory, correctRecord } = require('./services/history.service');
const summaryService = require('./services/summary.service');

exports.checkIn = async (req, res, next) => {
  const { latitude, longitude, gps_accuracy, device_identifier, photo_url, is_mock_location, notes } = req.body;
  const userId = req.user.id;
  const tenantId = req.tenantId;

  try {
    const workerId = await getWorkerIdFromUserId(userId, tenantId);
    await validateDevice(userId, device_identifier, tenantId);
    await validateGps(latitude, longitude, workerId, tenantId, is_mock_location);

    const existingCheckIn = await findActiveCheckIn(workerId);
    if (existingCheckIn) {
      return res.status(409).json({ success: false, message: 'Ya tienes una marcación de entrada activa para hoy.' });
    }

    const newRecord = await createCheckIn({
      workerId, tenantId, latitude, longitude, gps_accuracy, device_identifier, photo_url, notes
    });

    await logAudit({
      userId, companyId: tenantId, module: 'ATTENDANCE', action: 'CHECK_IN',
      entity: 'attendance_records', entityId: newRecord.id, req
    });

    res.status(201).json({ success: true, data: newRecord });
  } catch (error) {
    next(error);
  }
};

exports.checkOut = async (req, res, next) => {
  const { latitude, longitude, gps_accuracy, device_identifier, photo_url, notes } = req.body;
  const userId = req.user.id;
  const tenantId = req.tenantId;

  try {
    const workerId = await getWorkerIdFromUserId(userId, tenantId);
    await validateDevice(userId, device_identifier, tenantId);

    const activeCheckIn = await findActiveCheckIn(workerId);
    if (!activeCheckIn) {
      return res.status(400).json({ success: false, message: 'No se encontró una marcación de entrada activa para hoy.' });
    }

    const updatedRecord = await updateCheckOut(activeCheckIn.id, {
      latitude, longitude, gps_accuracy, photo_url, notes
    });

    await logAudit({
      userId, companyId: tenantId, module: 'ATTENDANCE', action: 'CHECK_OUT',
      entity: 'attendance_records', entityId: updatedRecord.id, req
    });

    res.status(200).json({ success: true, data: updatedRecord });
  } catch (error) {
    next(error);
  }
};

exports.getToday = async (req, res, next) => {
  try {
    const workerId = await getWorkerIdFromUserId(req.user.id, req.tenantId);
    const summary = await summaryService.getTodayAttendance(workerId, req.tenantId);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

exports.getMonthSummary = async (req, res, next) => {
  try {
    const workerId = await getWorkerIdFromUserId(req.user.id, req.tenantId);
    const summary = await summaryService.getMonthSummary(workerId, req.tenantId);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

exports.getMyAttendanceHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;
    const workerId = await getWorkerIdFromUserId(userId, tenantId);
    
    const { page, limit, startDate, endDate } = req.query;
    const result = await getHistory(workerId, tenantId, { page, limit, startDate, endDate });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerAttendanceHistory = async (req, res, next) => {
  try {
    const { workerId } = req.params;
    const tenantId = req.tenantId;
    const { page, limit, startDate, endDate } = req.query;

    // Validar que el workerId pertenece al tenant
    const workerCheck = await query('SELECT id FROM workers WHERE id = $1 AND company_id = $2', [workerId, tenantId]);
    if (workerCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Trabajador no encontrado.' });
    }

    const result = await getHistory(workerId, tenantId, { page, limit, startDate, endDate });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.correctAttendance = async (req, res, next) => {
  try {
    const { recordId } = req.params;
    const { check_in_time, check_out_time, reason } = req.body;
    const correctorId = req.user.id;
    const tenantId = req.tenantId;

    const correctedRecord = await correctRecord(recordId, tenantId, {
      check_in_time, check_out_time, reason, correctorId
    });

    await logAudit({
      userId: correctorId, companyId: tenantId, module: 'ATTENDANCE', action: 'CORRECT',
      entity: 'attendance_records', entityId: recordId, newData: { reason }, req
    });

    res.json({ success: true, data: correctedRecord });
  } catch (error) {
    next(error);
  }
};
