const express = require('express');
const router = express.Router();
const attendanceController = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Control de asistencia, marcaciones (check-in/check-out) y correcciones.
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * /attendance/check-in:
 *   post:
 *     summary: Realizar marcación de entrada (Check-in)
 *     description: Registra la hora de entrada de un trabajador. Valida la ubicación GPS, el dispositivo y detecta ubicaciones falsas.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckInInput'
 *     responses:
 *       '201':
 *         description: Check-in registrado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceRecord'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         description: "Errores de validación como GPS fuera de rango, dispositivo no confiable o bloqueado."
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/responses/DeviceBlocked'
 *                 - $ref: '#/components/responses/DeviceNotTrusted'
 *                 - $ref: '#/components/responses/GpsOutOfRange'
 *                 - $ref: '#/components/responses/FakeGpsDetected'
 *       '409':
 *         description: "Conflicto, por ejemplo, ya existe un check-in para hoy."
 *       '500':
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/check-in', attendanceController.checkIn);

/**
 * @swagger
 * /attendance/check-out:
 *   post:
 *     summary: Realizar marcación de salida (Check-out)
 *     description: Registra la hora de salida de un trabajador. Requiere un check-in previo en el día.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckOutInput'
 *     responses:
 *       '200':
 *         description: Check-out registrado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceRecord'
 *       '400':
 *         description: "No se encontró un check-in previo para hoy."
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/DeviceBlocked'
 *       '404':
 *         description: "Registro de asistencia para el día no encontrado."
 *       '500':
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/check-out', attendanceController.checkOut);

/**
 * @swagger
 * /attendance/history/my-records:
 *   get:
 *     summary: Obtener mi historial de asistencia
 *     description: Devuelve el historial paginado de marcaciones del usuario autenticado.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 15
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       '200':
 *         description: Historial de asistencia.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedSuccessResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '500':
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/history/my-records', attendanceController.getMyAttendanceHistory);

/**
 * @swagger
 * /attendance/history/worker/{workerId}:
 *   get:
 *     summary: Obtener historial de asistencia de un trabajador
 *     description: Devuelve el historial de marcaciones de un trabajador específico. Requiere permiso 'attendance.read'.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workerId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       '200':
 *         description: Historial de asistencia del trabajador.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '500':
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/history/worker/:workerId', requirePermission('attendance.read'), attendanceController.getWorkerAttendanceHistory);

/**
 * @swagger
 * /attendance/records/{recordId}/correct:
 *   patch:
 *     summary: Corregir una marcación
 *     description: Permite a un administrador o RRHH corregir una marcación existente. Requiere permiso 'attendance.correct'.
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID del registro de asistencia a corregir.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AttendanceCorrectionInput'
 *     responses:
 *       '200':
 *         description: Marcación corregida exitosamente.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 *       '500':
 *         $ref: '#/components/responses/InternalServerError'
 */
router.patch('/records/:recordId/correct', requirePermission('attendance.correct'), attendanceController.correctAttendance);

module.exports = router;
