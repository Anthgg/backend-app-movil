const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');
const shiftController = require('./controllers/shift.controller');

/**
 * @swagger
 * tags:
 *   name: Shifts
 *   description: Configuración de turnos (fijos, rotativos, nocturnos) y tolerancia
 */

router.use(authenticateToken);

// Endpoints para Admin/RRHH
router.get('/shifts', requirePermission('shifts.read'), shiftController.getShifts);
router.post('/shifts', requirePermission('shifts.manage'), shiftController.createShift);
router.get('/shifts/:id', requirePermission('shifts.read'), shiftController.getShiftById);
router.put('/shifts/:id', requirePermission('shifts.manage'), shiftController.updateShift);
router.delete('/shifts/:id', requirePermission('shifts.manage'), shiftController.deleteShift);

// Asignación de turnos
router.put('/workers/:id/shift', requirePermission('shifts.manage'), shiftController.assignShift);
router.get('/workers/:id/shift', requirePermission('shifts.read'), shiftController.getWorkerShift);

// Endpoints para el Trabajador
router.get('/profile/my-shift', shiftController.getMyShift);

module.exports = router;
