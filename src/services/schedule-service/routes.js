const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');
const shiftController = require('./controllers/shift.controller');

/**
 * @swagger
 * tags:
 *   name: Shifts
 *   description: Turnos, politicas laborales y asignaciones de horario.
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

const adminOrHr = authorizeRoles('ADMIN', 'RRHH');

router.get('/policies', shiftController.getPolicy);
router.put('/policies', adminOrHr, requirePermission('labor_policies.manage'), shiftController.updatePolicy);

router.get('/shifts', requirePermission('shifts.read'), shiftController.getShifts);
router.post('/shifts', adminOrHr, requirePermission('shifts.manage'), shiftController.createShift);
router.get('/shifts/:id', requirePermission('shifts.read'), shiftController.getShiftById);
router.put('/shifts/:id', adminOrHr, requirePermission('shifts.manage'), shiftController.updateShift);
router.delete('/shifts/:id', adminOrHr, requirePermission('shifts.manage'), shiftController.deleteShift);

router.get('/assignments', requirePermission('schedule.assignments.read'), shiftController.getAssignments);
router.post('/assignments', adminOrHr, requirePermission('schedule.assignments.manage'), shiftController.createAssignment);
router.put('/assignments/:id', adminOrHr, requirePermission('schedule.assignments.manage'), shiftController.updateAssignment);

router.put('/workers/:id/shift', adminOrHr, requirePermission('shifts.manage'), shiftController.assignShift);
router.get('/workers/:id/shift', requirePermission('shifts.read'), shiftController.getWorkerShift);
router.get('/workers/:id/schedule', requirePermission('schedule.assignments.read'), shiftController.getWorkerSchedule);

router.post('/workers/:workerId/rest-days', adminOrHr, requirePermission('shifts.manage'), shiftController.setRestDay);
router.delete('/workers/:workerId/rest-days', adminOrHr, requirePermission('shifts.manage'), shiftController.removeRestDay);


router.get('/attendance-summary', requirePermission('attendance.read'), shiftController.getAttendanceSummary);

router.get('/profile/my-shift', shiftController.getMyShift);
router.get('/profile/my-schedule', shiftController.getMySchedule);

module.exports = router;
