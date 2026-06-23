const express = require('express');
const router = express.Router();
const controller = require('../controllers/attendance.controller');
const analyticsController = require('../controllers/analytics.controller');
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

// Analytics responses are already grouped and normalized for charts. Clients
// must render these values without rebuilding attendance business rules.
/**
 * @swagger
 * /attendance/analytics/dashboard:
 *   get:
 *     summary: Dashboard completo de analitica de asistencia
 *     description: Devuelve KPIs, rankings y series ya agrupados, filtrados y normalizados por el backend.
 *     tags: [Attendance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: month, schema: { type: string, example: 2026-06 } }
 *       - { in: query, name: startDate, schema: { type: string, format: date } }
 *       - { in: query, name: endDate, schema: { type: string, format: date } }
 *       - { in: query, name: areaId, schema: { type: string, format: uuid } }
 *       - { in: query, name: departmentId, schema: { type: string, format: uuid } }
 *       - { in: query, name: positionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: workerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: workLocationId, schema: { type: string, format: uuid } }
 *       - { in: query, name: crewId, schema: { type: string, format: uuid } }
 *       - { in: query, name: status, schema: { type: string, example: PRESENT,LATE,ABSENT } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 10 } }
 *     responses:
 *       200:
 *         description: Datos listos para pintar en dashboard.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AttendanceAnalyticsDashboard' }
 *       400: { description: Fecha, rango o UUID invalido. }
 *       403: { description: Falta el permiso attendance.read. }
 */
router.get('/analytics/today', requirePermission('attendance.read'), analyticsController.getToday);
router.get('/analytics/monthly', requirePermission('attendance.read'), analyticsController.getMonthly);
router.get('/analytics/table', requirePermission('attendance.read'), analyticsController.getTable);
router.get('/analytics/workers', requirePermission('attendance.read'), analyticsController.getWorkers);
router.get('/analytics/workers/:workerId/summary', requirePermission('attendance.read'), analyticsController.getWorkerSummary);
router.get('/analytics/workers/:workerId', requirePermission('attendance.read'), analyticsController.getWorkerDetail);
router.get('/analytics/areas', requirePermission('attendance.read'), analyticsController.getAreas);
router.get('/analytics/areas/:areaId', requirePermission('attendance.read'), analyticsController.getAreaDetail);
router.get('/analytics/departments', requirePermission('attendance.read'), analyticsController.getDepartments);
router.get('/analytics/work-locations', requirePermission('attendance.read'), analyticsController.getWorkLocations);
router.get('/analytics/work-locations/:workLocationId', requirePermission('attendance.read'), analyticsController.getWorkLocationDetail);
router.get('/analytics/crews', requirePermission('attendance.read'), analyticsController.getCrews);
router.get('/analytics/crews/:crewId', requirePermission('attendance.read'), analyticsController.getCrewDetail);
router.get('/analytics/trends/daily', requirePermission('attendance.read'), analyticsController.getDailyTrend);
router.get('/analytics/trends/weekly', requirePermission('attendance.read'), analyticsController.getWeeklyTrend);
router.get('/analytics/rankings/absences', requirePermission('attendance.read'), analyticsController.getAbsenceRanking);
router.get('/analytics/rankings/lates', requirePermission('attendance.read'), analyticsController.getLateRanking);
router.get('/analytics/rankings/best-attendance', requirePermission('attendance.read'), analyticsController.getBestAttendanceRanking);
router.get('/analytics/rankings/areas/absences', requirePermission('attendance.read'), analyticsController.getAreaAbsenceRanking);
router.get('/analytics/rankings/areas/lates', requirePermission('attendance.read'), analyticsController.getAreaLateRanking);
router.get('/analytics/rankings/work-locations/absences', requirePermission('attendance.read'), analyticsController.getWorkLocationAbsenceRanking);
router.get('/analytics/rankings/work-locations/lates', requirePermission('attendance.read'), analyticsController.getWorkLocationLateRanking);
router.get('/analytics/rankings/work-locations/best-attendance', requirePermission('attendance.read'), analyticsController.getBestWorkLocationRanking);
router.get('/analytics/rankings/crews/absences', requirePermission('attendance.read'), analyticsController.getCrewAbsenceRanking);
router.get('/analytics/rankings/crews/lates', requirePermission('attendance.read'), analyticsController.getCrewLateRanking);
router.get('/analytics/rankings/crews/best-attendance', requirePermission('attendance.read'), analyticsController.getBestCrewRanking);
router.get('/analytics/kpis', requirePermission('attendance.read'), analyticsController.getKpis);
router.get('/analytics/dashboard', requirePermission('attendance.read'), analyticsController.getDashboard);
router.get('/analytics/export/filters', requirePermission('attendance.read'), analyticsController.getExportFilters);
router.get('/analytics/export', requirePermission('attendance.read'), analyticsController.exportAnalytics);
router.post('/analytics/export', requirePermission('attendance.read'), analyticsController.exportAnalytics);
router.post('/analytics/recalculate', requirePermission('manage_attendance'), analyticsController.recalculate);

router.post('/debug', upload.single('photo'), (req, res) => {
  console.log('=== DEBUG ATTENDANCE REQ.BODY ===');
  console.log('req.body:', req.body);
  console.log('req.files:', req.files);
  console.log('req.file:', req.file);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('=================================');
  res.json({
    success: true,
    received: req.body,
    file: req.file ? req.file.fieldname : null
  });
});

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
 * /attendance/overtime/activate:
 *   post:
 *     summary: Activar horas extra para un trabajador
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               attendanceId:
 *                 type: string
 *               maxOvertimeMinutes:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Horas extra activadas
 */
router.post('/overtime/activate', requirePermission('manage_attendance'), controller.activateOvertime);

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
router.patch('/:id/correction', requirePermission('attendance.correct'), controller.manualCorrection);

/**
 * @swagger
 * /attendance/correction:
 *   post:
 *     summary: Crear o corregir una asistencia manualmente
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               worker_id:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date
 *               check_in_time:
 *                 type: string
 *               check_out_time:
 *                 type: string
 *               status:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Corrección aplicada con éxito.
 */
router.post('/correction', requirePermission('attendance.correct'), controller.manualCorrection);

module.exports = router;
