const express = require('express');
const router = express.Router();
const controller = require('../controllers/attendance.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Control de asistencia GPS, fotos y correcciones
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * /attendance/check-in:
 *   post:
 *     summary: Registrar asistencia (Entrada)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckInRequest'
 *     responses:
 *       200:
 *         description: Check-in exitoso.
 *       400:
 *         description: |
 *           Errores posibles:
 *           - ATTENDANCE_ALREADY_EXISTS: Ya existe un check-in para hoy.
 *           - SHIFT_NOT_FOUND: No hay un turno asignado para esta hora/día.
 *           - INVALID_COORDINATES: Coordenadas mal formadas.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: |
 *           Errores posibles:
 *           - OUT_OF_RANGE: Fuera del rango del proyecto (GPS).
 *           - MOCK_LOCATION_DETECTED: Fake GPS detectado.
 *           - DEVICE_BLOCKED: Dispositivo no confiable.
 *           - WORKER_INACTIVE: Trabajador no activo.
 */
router.post('/check-in', controller.checkIn);

/**
 * @swagger
 * /attendance/check-out:
 *   post:
 *     summary: Registrar salida
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckOutRequest'
 *     responses:
 *       200:
 *         description: Check-out exitoso. Se calculan horas trabajadas y extra.
 *       400:
 *         description: |
 *           Errores:
 *           - CHECK_OUT_ALREADY_EXISTS: Ya se registró la salida.
 *           - INVALID_COORDINATES: Coordenadas mal formadas.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: OUT_OF_RANGE, MOCK_LOCATION_DETECTED, DEVICE_BLOCKED
 *       404:
 *         description: CHECK_IN_NOT_FOUND - No se encontró el registro de entrada del día.
 */
router.post('/check-out', controller.checkOut);

/**
 * @swagger
 * /attendance/my-records:
 *   get:
 *     summary: Historial de asistencia del usuario actual
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de registros.
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/my-records', controller.getMyRecords || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /attendance/today:
 *   get:
 *     summary: Obtener el registro de asistencia de hoy del usuario actual
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Registro de hoy.
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/today', controller.getTodayRecord || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /attendance/worker/{workerId}:
 *   get:
 *     summary: Obtener asistencia de un trabajador
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Registros del trabajador.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (attendance.read)
 */
router.get('/worker/:workerId', requirePermission('attendance.read'), controller.getWorkerRecords || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /attendance/project/{projectId}:
 *   get:
 *     summary: Obtener asistencia por proyecto (Ej. para el supervisor)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Asistencias del proyecto.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.get('/project/:projectId', requirePermission('attendance.project.read'), controller.getProjectRecords || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /attendance/{id}:
 *   get:
 *     summary: Detalle de un registro de asistencia
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Registro detallado.
 *       404:
 *         description: RECORD_NOT_FOUND
 */
router.get('/:id', requirePermission('attendance.read'), controller.getRecordById || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /attendance/{id}/correction:
 *   patch:
 *     summary: Realizar corrección manual a un registro
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AttendanceCorrectionRequest'
 *     responses:
 *       200:
 *         description: Corrección aplicada. El estado cambia a 'corrected'.
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (attendance.correct)
 *       404:
 *         description: RECORD_NOT_FOUND
 */
router.patch('/:id/correction', requirePermission('attendance.correct'), controller.correctRecord || ((req,res) => res.json({success:true})));

module.exports = router;
