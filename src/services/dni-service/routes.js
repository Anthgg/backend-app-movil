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
 *   name: DNI
 *   description: Consulta externa de datos por DNI
 */

/**
 * @swagger
 * /dni/{dni}:
 *   get:
 *     summary: Consulta datos personales por DNI usando el proveedor externo configurado.
 *     tags: [DNI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dni
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9]{8}$'
 *     responses:
 *       200:
 *         description: Datos encontrados.
 *       400:
 *         description: DNI inválido.
 *       401:
 *         description: Token requerido.
 *       403:
 *         description: Permisos insuficientes.
 *       404:
 *         description: DNI no encontrado.
 *       502:
 *         description: Error del proveedor externo.
 */
router.get('/:dni', authorizeRoles('ADMIN', 'RRHH'), controller.lookupDni);

module.exports = router;
