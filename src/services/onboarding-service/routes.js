const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * tags:
 *   name: Onboarding
 *   description: Alta integral de colaboradores
 */

/**
 * @swagger
 * /workers/onboarding:
 *   post:
 *     summary: Crea trabajador, contrato y usuario de acceso en un flujo transaccional.
 *     tags: [Onboarding]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WorkerOnboardingRequest'
 *     responses:
 *       201:
 *         description: Colaborador creado correctamente o con advertencias.
 *       400:
 *         description: Datos invalidos.
 *       401:
 *         description: Token requerido.
 *       403:
 *         description: Permisos insuficientes o tenant incorrecto.
 *       409:
 *         description: DNI, username o correo duplicado.
 *       422:
 *         description: Validacion de negocio fallida.
 *       500:
 *         description: Error interno.
 */
router.get('/onboarding-prefill', authorizeRoles('ADMIN', 'RRHH'), controller.getOnboardingPrefill);
router.post('/onboarding', authorizeRoles('ADMIN', 'RRHH'), controller.onboardWorker);

module.exports = router;
