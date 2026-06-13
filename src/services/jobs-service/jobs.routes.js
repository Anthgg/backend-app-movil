const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');
const jobController = require('./jobs.controller');

/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Ejecución manual de tareas programadas (Cronjobs)
 */

const cronAuthMiddleware = (req, res, next) => {
  const cronSecret = req.header('X-CRON-SECRET');
  if (cronSecret && process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET) {
    req.user = { isCron: true };
    return next();
  }
  authenticateToken(req, res, next);
};

const cronPermissionMiddleware = (permission) => {
  return (req, res, next) => {
    if (req.user && req.user.isCron) return next();
    return requirePermission(permission)(req, res, next);
  };
};

router.use(cronAuthMiddleware);
router.use((req, res, next) => {
  if (req.user && req.user.isCron) {
    req.tenantId = req.body?.company_id || req.query?.company_id || req.header('X-Company-Id');
    if (!req.tenantId) {
      return res.status(400).json({
        success: false,
        message: 'company_id es obligatorio para ejecutar jobs con X-CRON-SECRET',
        error_code: 'COMPANY_ID_REQUIRED'
      });
    }
    return next();
  }

  return tenantMiddleware(req, res, next);
});

/**
 * @swagger
 * /jobs/attendance/generate-absences:
 *   post:
 *     summary: Generar inasistencias
 *     description: >
 *       Procesa los trabajadores que no registraron asistencia en la fecha indicada y les marca 'absent'.
 *       Ejecución manual: `trigger_type: manual`.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: target_date
 *         schema: { type: string, format: date }
 *         description: Fecha objetivo (por defecto ayer)
 *     responses:
 *       200:
 *         description: Job finalizado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/JobRun'
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (jobs.execute)
 *       409:
 *         description: JOB_ALREADY_RUNNING - El job ya se está ejecutando.
 *       500:
 *         description: JOB_FAILED
 */
router.post('/attendance/generate-absences', cronPermissionMiddleware('jobs.execute'), jobController.generateAbsences);

/**
 * @swagger
 * /jobs/attendance/close-incomplete:
 *   post:
 *     summary: Cerrar turnos incompletos
 *     description: Marca como 'incomplete' los registros con entrada pero sin salida pasada su tolerancia.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: target_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Job finalizado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/JobRun'
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/attendance/close-incomplete', cronPermissionMiddleware('jobs.execute'), jobController.closeIncomplete);

/**
 * @swagger
 * /jobs/attendance/detect-suspicious:
 *   post:
 *     summary: Detectar registros sospechosos
 *     description: Analiza registros (fuera de rango, mock location) y los marca como 'observed'.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: target_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Job finalizado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/JobRun'
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/attendance/detect-suspicious', cronPermissionMiddleware('jobs.execute'), jobController.detectSuspicious);

/**
 * @swagger
 * /jobs/attendance/recalculate-daily:
 *   post:
 *     summary: Recalcular métricas diarias
 *     description: Actualiza horas extra y minutos de tardanza en base a correcciones recientes.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: target_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Job finalizado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/JobRun'
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/attendance/recalculate-daily', cronPermissionMiddleware('jobs.execute'), jobController.recalculateDaily);

/**
 * @swagger
 * /jobs/attendance/run-all:
 *   post:
 *     summary: Ejecutar todos los jobs de asistencia
 *     description: "Corre secuencialmente: cerrar incompletos, generar inasistencias, detectar sospechosos y recalcular diarias."
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: target_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Secuencia de Jobs finalizada.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/JobRun'
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/attendance/run-all', cronPermissionMiddleware('jobs.execute'), jobController.runAll);

module.exports = router;
