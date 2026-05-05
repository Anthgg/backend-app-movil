const express = require('express');
const router = express.Router();
const controller = require('../controllers/payroll.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Payroll
 *   description: >
 *     Gestión de Planillas, incluyendo creación de periodos, generación de cálculos, recálculos, cierres y exportaciones.
 *     
 *     ### Estados del Periodo:
 *     - **open**: Periodo creado manualmente.
 *     - **generating**: Proceso asíncrono en curso.
 *     - **generated**: Planilla generada con cálculos preliminares.
 *     - **approved**: Planilla revisada y aprobada (lista para pagos).
 *     - **closed**: Planilla cerrada irreversiblemente.
 *
 *     ### Reglas de Recálculo:
 *     - Solo es posible si el estado es `generated` o `open`.
 *     - Si está `approved` o `closed`, no se puede recalcular.
 *     - Un recálculo consulta nuevamente los resúmenes mensuales y recalcula salarios.
 *
 *     ### Cierre y Exportación:
 *     - El cierre cambia el estado a `closed` e impide cualquier modificación futura.
 *     - La exportación a Excel entrega un reporte detallado con los cálculos de la planilla y está habilitada para estados `generated`, `approved` o `closed`.
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * /payroll/my-paystubs:
 *   get:
 *     summary: Obtener mis boletas de pago (historial)
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de boletas devuelta.
 */
router.get('/my-paystubs', controller.getMyPaystubs);

/**
 * @swagger
 * /payroll/periods:
 *   post:
 *     summary: Crear un nuevo periodo de planilla
 *     description: >
 *       Crea un nuevo periodo en estado `open`. Requiere especificar el año, mes, fecha de inicio y fin.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PayrollPeriod'
 *           example:
 *             name: "Planilla Mayo 2026"
 *             year: 2026
 *             month: 5
 *             start_date: "2026-05-01"
 *             end_date: "2026-05-31"
 *     responses:
 *       201:
 *         description: Periodo creado exitosamente.
 *       400:
 *         description: VALIDATION_ERROR - Fechas inválidas o datos incompletos.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (payroll.periods.create)
 *       500:
 *         description: INTERNAL_SERVER_ERROR
 */
router.post('/periods', requirePermission('payroll.periods.create'), controller.createPeriod);

/**
 * @swagger
 * /payroll/periods:
 *   get:
 *     summary: Obtener la lista de periodos de planilla
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, generating, generated, approved, closed] }
 *     responses:
 *       200:
 *         description: Lista de periodos.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (payroll.periods.read)
 */
router.get('/periods', requirePermission('payroll.periods.read'), controller.getPeriods);

/**
 * @swagger
 * /payroll/periods/{id}/generate:
 *   patch:
 *     summary: Generar registros de planilla para un periodo
 *     description: >
 *       Inicia la generación de la planilla basándose en las inasistencias y tardanzas.
 *       Cambia el estado de `open` a `generating` y luego a `generated` (de forma síncrona en este demo).
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Generación iniciada o completada exitosamente.
 *       400:
 *         description: INVALID_STATE_ERROR - El periodo no está en estado 'open'.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (payroll.periods.generate)
 *       404:
 *         description: PERIOD_NOT_FOUND
 *       500:
 *         description: GENERATION_ERROR
 */
router.patch('/periods/:id/generate', requirePermission('payroll.periods.generate'), controller.generatePayroll);

/**
 * @swagger
 * /payroll/periods/{id}/recalculate:
 *   patch:
 *     summary: Recalcular la planilla de un periodo
 *     description: >
 *       Permite recalcular la planilla obteniendo datos actualizados (ej. corrección en inasistencias).
 *       **Regla de recálculo**: Solo permitido en estados `open` o `generated`. Falla si está `approved` o `closed`.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Planilla recalculada.
 *       400:
 *         description: INVALID_STATE_ERROR - No se puede recalcular un periodo cerrado o aprobado.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (payroll.periods.recalculate)
 *       404:
 *         description: PERIOD_NOT_FOUND
 *       500:
 *         description: RECALCULATION_ERROR
 */
router.patch('/periods/:id/recalculate', requirePermission('payroll.periods.recalculate'), controller.recalculatePayroll);

/**
 * @swagger
 * /payroll/periods/{id}/approve:
 *   patch:
 *     summary: Aprobar un periodo de planilla
 *     description: >
 *       Aprueba la planilla, previniendo más recálculos accidentales y dejándola lista para pagos o cierre.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Periodo aprobado.
 *       400:
 *         description: INVALID_STATE_ERROR - Solo se pueden aprobar periodos 'generated'.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (payroll.periods.approve)
 *       404:
 *         description: PERIOD_NOT_FOUND
 */
router.patch('/periods/:id/approve', requirePermission('payroll.periods.approve'), controller.approvePeriod);

/**
 * @swagger
 * /payroll/periods/{id}/close:
 *   patch:
 *     summary: Cerrar un periodo de planilla
 *     description: >
 *       Cierre final de la planilla. Bloquea cualquier modificación posterior.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Periodo cerrado exitosamente.
 *       400:
 *         description: INVALID_STATE_ERROR - Requiere estar en 'approved' (o 'generated' según configuración).
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (payroll.periods.close)
 *       404:
 *         description: PERIOD_NOT_FOUND
 */
router.patch('/periods/:id/close', requirePermission('payroll.periods.close'), controller.closePeriod);

/**
 * @swagger
 * /payroll/periods/{id}/export/excel:
 *   get:
 *     summary: Exportar planilla a Excel
 *     description: >
 *       Genera un reporte consolidado en Excel con sueldos brutos, deducciones, bonos y neto final de cada trabajador para este periodo.
 *       **Nota**: La respuesta es un archivo binario.
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Archivo Excel generado
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="payroll-period-xxx.xlsx"
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS (payroll.export)
 *       404:
 *         description: PERIOD_NOT_FOUND
 *       500:
 *         description: EXPORT_GENERATION_ERROR
 */
router.get('/periods/:id/export/excel', requirePermission('payroll.export'), controller.exportExcel);

// Endpoints comentados previamente:
// router.get('/periods/:id', requirePermission('payroll.periods.read'), controller.getPeriodById);
// router.patch('/periods/:id/reopen', requirePermission('payroll.periods.reopen'), controller.reopenPeriod);
// router.get('/periods/:id/records', requirePermission('payroll.records.read'), controller.getPeriodRecords);
// router.get('/records/:id', requirePermission('payroll.records.read'), controller.getRecordById);
// router.get('/periods/:id/export/pdf', requirePermission('payroll.export'), controller.exportPdf);

module.exports = router;
