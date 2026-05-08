const express = require('express');
const router = express.Router();
const authController = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Autenticación, sesiones y 2FA
 */

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Inicia sesión de usuario
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login exitoso. Si tiene 2FA activo, devuelve tempToken y flag requiresTwoFactor.
 *       401:
 *         description: Credenciales inválidas.
 *       403:
 *         description: Usuario desactivado o bloqueado.
 */
router.post('/login', authController.login);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Cierra sesión
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout exitoso.
 */
router.post('/logout', authenticateToken, authController.logout);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Cambiar la contraseña del usuario autenticado
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contraseña actualizada.
 *       400:
 *         description: Datos incompletos.
 *       401:
 *         description: Contraseña actual inválida.
 *       422:
 *         description: Nueva contraseña débil o repetida.
 */
router.post('/change-password', authenticateToken, authController.changePassword);

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Renueva el Access Token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nuevo par de tokens generado.
 */
router.post('/refresh-token', authController.refreshToken);

/**
 * @swagger
 * /auth/2fa/status:
 *   get:
 *     summary: Obtener estado de 2FA del usuario
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Estado devuelto.
 */
router.get('/2fa/status', authenticateToken, authController.get2FAStatus);

/**
 * @swagger
 * /auth/2fa/enable:
 *   post:
 *     summary: Iniciar configuración de 2FA (Genera QR)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR y secreto generados.
 */
router.post('/2fa/enable', authenticateToken, authController.enable2FA);

/**
 * @swagger
 * /auth/2fa/confirm:
 *   post:
 *     summary: Confirmar y activar 2FA con el primer código
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: 2FA activado.
 */
router.post('/2fa/confirm', authenticateToken, authController.confirm2FA);

/**
 * @swagger
 * /auth/2fa/verify:
 *   post:
 *     summary: Verificar 2FA durante el login (usando tempToken)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tempToken:
 *                 type: string
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login completado. Devuelve tokens finales.
 */
router.post('/2fa/verify', authController.verify2FALogin);

/**
 * @swagger
 * /auth/2fa/disable:
 *   post:
 *     summary: Deshabilitar 2FA
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 2FA deshabilitado.
 */
router.post('/2fa/disable', authenticateToken, authController.disable2FA);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Obtener perfil del usuario autenticado
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Datos del usuario.
 */
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
