const express = require('express');
const router = express.Router();
const dashboardController = require('./dashboard.controller');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: KPIs y métricas para la pantalla principal (Home)
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * /dashboard/worker/home:
 *   get:
 *     summary: Dashboard móvil del trabajador
 *     description: Devuelve el estado actual de asistencia, resumen del mes y conteo de solicitudes/documentos para el trabajador autenticado.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Datos del home trabajador obtenidos.
 */
router.get('/worker/home', dashboardController.getWorkerHome);

// --- Rutas de Admin/Supervisor (Requieren dashboard.read) ---
router.use(requirePermission('dashboard.read'));

/**
 * @swagger
 * /dashboard/summary:
 *   get:
 *     summary: Resumen general de KPIs
 *     description: Devuelve totales de trabajadores, asistencia de hoy, solicitudes pendientes y contratos por vencer. Aplica reglas de supervisor por proyecto.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *         description: Filtra por proyecto (requerido para supervisores).
 *     responses:
 *       200:
 *         description: Resumen obtenido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardSummary'
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/summary', dashboardController.getSummary);

/**
 * @swagger
 * /dashboard/attendance-today:
 *   get:
 *     summary: Asistencia del día actual
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de estados de asistencia del día.
 */
router.get('/attendance-today', dashboardController.getAttendanceToday);

/**
 * @swagger
 * /dashboard/pending-requests:
 *   get:
 *     summary: Solicitudes pendientes de aprobación
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de solicitudes pendientes.
 */
router.get('/pending-requests', dashboardController.getPendingRequests || ((req,res)=>res.json({success:true})));

/**
 * @swagger
 * /dashboard/worker-status:
 *   get:
 *     summary: Estado de trabajadores
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de trabajadores con su estado actual (trabajando, libre, descanso médico).
 */
router.get('/worker-status', dashboardController.getWorkerStatus);

/**
 * @swagger
 * /dashboard/contracts-expiring:
 *   get:
 *     summary: Contratos por vencer
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Trabajadores cuyos contratos vencen en los próximos 30 días.
 */
router.get('/contracts-expiring', dashboardController.getContractsExpiring || ((req,res)=>res.json({success:true})));

/**
 * @swagger
 * /dashboard/documents-pending:
 *   get:
 *     summary: Documentos pendientes
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Trabajadores con documentos legales o RRHH pendientes.
 */
router.get('/documents-pending', dashboardController.getDocumentsPending || ((req,res)=>res.json({success:true})));

/**
 * @swagger
 * /dashboard/late-workers:
 *   get:
 *     summary: Trabajadores con tardanzas hoy
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de trabajadores en estado 'late'.
 */
router.get('/late-workers', dashboardController.getLateWorkers || ((req,res)=>res.json({success:true})));

/**
 * @swagger
 * /dashboard/project-summary:
 *   get:
 *     summary: Resumen por proyecto
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KPIs agrupados por proyecto.
 */
router.get('/project-summary', dashboardController.getProjectSummary || ((req,res)=>res.json({success:true})));

module.exports = router;
