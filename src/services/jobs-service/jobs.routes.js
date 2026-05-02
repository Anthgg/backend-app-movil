const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

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
router.post('/attendance/generate-absences', cronPermissionMiddleware('jobs.execute'), (req, res) => res.json({ success: true }));

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
router.post('/attendance/close-incomplete', cronPermissionMiddleware('jobs.execute'), (req, res) => res.json({ success: true }));

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
router.post('/attendance/detect-suspicious', cronPermissionMiddleware('jobs.execute'), (req, res) => res.json({ success: true }));

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
router.post('/attendance/recalculate-daily', cronPermissionMiddleware('jobs.execute'), (req, res) => res.json({ success: true }));

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
router.post('/attendance/run-all', cronPermissionMiddleware('jobs.execute'), (req, res) => res.json({ success: true }));

module.exports = router;
