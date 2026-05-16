const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/today', controller.getToday);
router.get('/upcoming', controller.getUpcoming);
router.get('/month', controller.getMonth);

/**
 * @swagger
 * /birthdays/greet:
 *   post:
 *     summary: Enviar saludo de cumpleaños a otro trabajador
 *     tags: [Birthdays]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetUserId
 *             properties:
 *               targetUserId:
 *                 type: string
 *                 format: uuid
 *                 description: ID del usuario al que se envía el saludo.
 *     responses:
 *       200:
 *         description: Saludo enviado correctamente.
 *       400:
 *         description: No puedes enviarte un saludo a ti mismo.
 *       404:
 *         description: Destinatario no encontrado.
 */
router.post('/greet', controller.sendGreeting);

module.exports = router;
