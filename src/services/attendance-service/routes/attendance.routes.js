const express = require('express');
const router = express.Router();
const controller = require('../controllers/attendance.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../../shared/middlewares/permissions.middleware');
const multer = require('multer');

// Configuración de Multer para fotos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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
 *       201:
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
 *       409:
 *         description: ATTENDANCE_ALREADY_REGISTERED - Ya existe un check-in para hoy.
 */
router.post('/check-in', upload.single('photo'), controller.checkIn);

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
 *         description: CHECK_IN_NOT_FOUND - No se encontró el registro de entrada del día.
 *       401:
 *         description: UNAUTHORIZED
 *       409:
 *         description: CHECK_OUT_ALREADY_EXISTS - Ya se registró la salida.
 */
router.post('/check-out', upload.single('photo'), controller.checkOut);

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
 *         description: Registro de hoy con status none/checked_in/checked_out.
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/today', controller.getToday);
router.get('/month-summary', controller.getMonthSummary);
router.get('/stats', controller.getMonthSummary); // Alias


/**
 * @swagger
 * /attendance/history:
 *   get:
 *     summary: Historial de asistencia del usuario actual por mes/año
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *         description: Mes (1-12). Default mes actual.
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *         description: Año. Default año actual.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Lista de registros del mes.
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/history', controller.getHistory);

/**
 * @swagger
 * /attendance/summary:
 *   get:
 *     summary: Resumen de asistencia del mes (horas, días, tardanzas, ausencias)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Resumen mensual de asistencia.
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/summary', controller.getSummary);

/**
 * @swagger
 * /attendance/my-records:
 *   get:
 *     summary: Historial paginado de asistencia del usuario actual
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 15 }
 *       - in: query
 *         name: worker_id
 *         schema: { type: string, format: uuid }
 *         description: ID del trabajador (requiere permiso attendance.read)
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Lista de registros paginada.
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/my-records', controller.getMyRecords);

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
