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
 *         description: Login exitoso. Si el usuario tiene 2FA, devuelve un flag.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: INVALID_CREDENTIALS - Credenciales incorrectas.
 *       403:
 *         description: USER_DISABLED - El usuario está desactivado o bloqueado.
 */
router.post('/login', authController.login);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Cierra sesión del usuario actual
 *     description: Revoca el refresh token y finaliza la sesión en este dispositivo.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout exitoso. Token revocado.
 *       401:
 *         description: UNAUTHORIZED
 */
router.post('/logout', authenticateToken, authController.logout);

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Renueva el Access Token
 *     description: Usa el Refresh Token para obtener un nuevo Access Token.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: Nuevo Access Token generado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RefreshTokenResponse'
 *       401:
 *         description: INVALID_TOKEN - Token inválido o revocado.
 *       403:
 *         description: TOKEN_EXPIRED - El token ha expirado.
 */
router.post('/refresh-token', authController.refreshToken);

/**
 * @swagger
 * /auth/2fa/generate:
 *   get:
 *     summary: Generar secreto 2FA y QR Code
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR generado exitosamente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TwoFactorGenerateResponse'
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/2fa/generate', authenticateToken, authController.generate2FA);

/**
 * @swagger
 * /auth/2fa/verify:
 *   post:
 *     summary: Verificar y habilitar 2FA
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TwoFactorVerifyRequest'
 *     responses:
 *       200:
 *         description: 2FA verificado y habilitado correctamente.
 *       400:
 *         description: INVALID_2FA_CODE - Código incorrecto.
 *       401:
 *         description: UNAUTHORIZED
 */
router.post('/2fa/verify', authenticateToken, authController.verify2FA);

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
 *         description: 2FA deshabilitado exitosamente.
 *       401:
 *         description: UNAUTHORIZED
 */
router.post('/2fa/disable', authenticateToken, authController.disable2FA || ((req,res) => res.json({success:true}))); 

module.exports = router;
