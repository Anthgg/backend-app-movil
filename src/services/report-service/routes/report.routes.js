const express = require('express');
const router = express.Router();
const controller = require('../controllers/report.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Generation of reports
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

const proxyToNotImplemented = (req, res) => res.status(501).json({ success: false, message: 'Not implemented yet in this demo' });

/**
 * @swagger
 * /reports/attendance:
 *   get:
 *     summary: Obtener reporte de asistencia (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *         example: "2026-05-01"
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *         example: "2026-05-31"
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         example: "late"
 *       - in: query
 *         name: worker_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GeneratedReport'
 *       400:
 *         description: VALIDATION_ERROR - Error de validación en los filtros.
 *       401:
 *         description: UNAUTHORIZED - Token no proporcionado o inválido.
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS - El usuario no tiene permisos (reports.attendance.read).
 *       500:
 *         description: REPORT_GENERATION_ERROR - Error generando el reporte.
 */
router.get('/attendance', requirePermission('reports.attendance.read'), controller.getAttendanceReport);

/**
 * @swagger
 * /reports/absences:
 *   get:
 *     summary: Obtener reporte de inasistencias (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: worker_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GeneratedReport'
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.absences.read)
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/absences', requirePermission('reports.absences.read'), proxyToNotImplemented);

/**
 * @swagger
 * /reports/lates:
 *   get:
 *     summary: Obtener reporte de tardanzas (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.lates.read)
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/lates', requirePermission('reports.lates.read'), proxyToNotImplemented);

/**
 * @swagger
 * /reports/requests:
 *   get:
 *     summary: Obtener reporte de solicitudes (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: request_type_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.requests.read)
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/requests', requirePermission('reports.requests.read'), proxyToNotImplemented);

/**
 * @swagger
 * /reports/vacations:
 *   get:
 *     summary: Obtener reporte de vacaciones (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: worker_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.vacations.read)
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/vacations', requirePermission('reports.vacations.read'), proxyToNotImplemented);

/**
 * @swagger
 * /reports/medical-leaves:
 *   get:
 *     summary: Obtener reporte de descansos médicos (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.medical_leaves.read)
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/medical-leaves', requirePermission('reports.medical_leaves.read'), proxyToNotImplemented);

/**
 * @swagger
 * /reports/workers:
 *   get:
 *     summary: Obtener reporte de trabajadores (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: department_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: job_position_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.workers.read)
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/workers', requirePermission('reports.workers.read'), proxyToNotImplemented);

/**
 * @swagger
 * /reports/monthly-summary:
 *   get:
 *     summary: Obtener reporte resumen mensual (JSON)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *         example: "2026-05-01"
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *         example: "2026-05-31"
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *         example: "123e4567-e89b-12d3-a456-426614174000"
 *       - in: query
 *         name: department_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Reporte generado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GeneratedReport'
 *       400:
 *         description: VALIDATION_ERROR - Fechas no proporcionadas o inválidas.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.monthly_summary.read)
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/monthly-summary', requirePermission('reports.monthly_summary.read'), controller.getMonthlySummary);

/**
 * @swagger
 * /reports/attendance/export/excel:
 *   get:
 *     summary: Exportar reporte de asistencia a Excel
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo Excel generado
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="attendance-report.xlsx"
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.attendance.export)
 *       404:
 *         description: REPORT_NOT_FOUND - No hay datos para generar el reporte.
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/attendance/export/excel', requirePermission('reports.attendance.export'), controller.exportAttendanceExcel);

/**
 * @swagger
 * /reports/attendance/export/pdf:
 *   get:
 *     summary: Exportar reporte de asistencia a PDF
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo PDF generado
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="attendance-report.pdf"
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.attendance.export)
 *       404:
 *         description: REPORT_NOT_FOUND
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/attendance/export/pdf', requirePermission('reports.attendance.export'), controller.exportAttendancePdf);

/**
 * @swagger
 * /reports/monthly-summary/export/excel:
 *   get:
 *     summary: Exportar reporte resumen mensual a Excel
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo Excel generado
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="monthly-summary.xlsx"
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.monthly_summary.export)
 *       404:
 *         description: REPORT_NOT_FOUND
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/monthly-summary/export/excel', requirePermission('reports.monthly_summary.export'), controller.exportMonthlySummaryExcel);

/**
 * @swagger
 * /reports/monthly-summary/export/pdf:
 *   get:
 *     summary: Exportar reporte resumen mensual a PDF
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo PDF generado
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="monthly-summary.pdf"
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: VALIDATION_ERROR
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (reports.monthly_summary.export)
 *       404:
 *         description: REPORT_NOT_FOUND
 *       500:
 *         description: REPORT_GENERATION_ERROR
 */
router.get('/monthly-summary/export/pdf', requirePermission('reports.monthly_summary.export'), controller.exportMonthlySummaryPdf);

/**
 * @swagger
 * /reports/requests/pdf:
 *   post:
 *     summary: Exportar reporte de solicitudes a PDF con diseño corporativo FABRYOR
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filters:
 *                 type: object
 *                 properties:
 *                   start_date: { type: string, format: date, example: "2026-05-01" }
 *                   end_date: { type: string, format: date, example: "2026-05-31" }
 *                   status: { type: string, example: "approved" }
 *                   worker_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo PDF generado exitosamente.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/requests/pdf', requirePermission('reports.requests.read'), controller.exportRequestsPdfCorporate);

/**
 * @swagger
 * /reports/attendance/pdf:
 *   post:
 *     summary: Exportar reporte de asistencia a PDF con diseño corporativo FABRYOR
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filters:
 *                 type: object
 *                 properties:
 *                   start_date: { type: string, format: date, example: "2026-05-01" }
 *                   end_date: { type: string, format: date, example: "2026-05-31" }
 *                   worker_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo PDF generado exitosamente.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/attendance/pdf', requirePermission('reports.attendance.export'), controller.exportAttendancePdfCorporate);

/**
 * @swagger
 * /reports/workers/pdf:
 *   post:
 *     summary: Exportar reporte de colaboradores a PDF con diseño corporativo FABRYOR
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filters:
 *                 type: object
 *                 properties:
 *                   status: { type: string, example: "ACTIVE" }
 *                   department_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo PDF generado exitosamente.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/workers/pdf', requirePermission('reports.workers.read'), controller.exportWorkersPdfCorporate);

/**
 * @swagger
 * /reports/payroll/pdf:
 *   post:
 *     summary: Exportar reporte de nómina (planilla) a PDF con diseño corporativo FABRYOR
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filters:
 *                 type: object
 *                 properties:
 *                   payroll_period_id: { type: string, format: uuid }
 *                   status: { type: string, example: "approved" }
 *     responses:
 *       200:
 *         description: Archivo PDF generado exitosamente.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.post('/payroll/pdf', requirePermission('payroll.export'), controller.exportPayrollPdfCorporate);

/**
 * @swagger
 * /reports/monthly-summary/pdf:
 *   post:
 *     summary: Exportar reporte de resumen mensual a PDF con diseño corporativo
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Archivo PDF generado exitosamente.
 */
router.post('/monthly-summary/pdf', requirePermission('reports.monthly_summary.export'), controller.exportMonthlySummaryPdfCorporate);

/**
 * @swagger
 * /reports/vacations/pdf:
 *   post:
 *     summary: Exportar reporte de vacaciones a PDF con diseño corporativo
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Archivo PDF generado exitosamente.
 */
router.post('/vacations/pdf', requirePermission('reports.vacations.export'), controller.exportVacationsPdfCorporate);

/**
 * @swagger
 * /reports/documents/pdf:
 *   post:
 *     summary: Exportar reporte de documentos a PDF con diseño corporativo
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Archivo PDF generado exitosamente.
 */
router.post('/documents/pdf', requirePermission('reports.workers.read'), controller.exportDocumentsPdfCorporate);

module.exports = router;
