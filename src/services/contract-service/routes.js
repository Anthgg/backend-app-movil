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
 *   name: Contracts
 *   description: Contract generation and signed document upload
 */

/**
 * @swagger
 * /contracts/generate:
 *   post:
 *     summary: Genera y guarda el PDF de un contrato laboral.
 *     tags: [Contracts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contract_id]
 *             properties:
 *               contract_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: PDF generado correctamente.
 *       400:
 *         description: Payload inválido.
 *       401:
 *         description: Token requerido.
 *       403:
 *         description: Permisos insuficientes.
 *       404:
 *         description: Contrato no encontrado.
 *       500:
 *         description: Error generando el contrato.
 */
router.post('/generate', authorizeRoles('ADMIN', 'RRHH'), controller.generateContract);

module.exports = router;
