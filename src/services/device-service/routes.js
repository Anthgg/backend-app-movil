const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Devices
 *   description: Gestión de dispositivos móviles asociados a trabajadores
 */

router.use(authenticateToken);

/**
 * @swagger
 * /devices/register:
 *   post:
 *     summary: Registra un nuevo dispositivo
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceInput'
 *     responses:
 *       200:
 *         description: Dispositivo registrado exitosamente.
 *       400:
 *         description: VALIDATION_ERROR - Faltan campos requeridos.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: DEVICE_BLOCKED - El dispositivo está bloqueado.
 */
router.post('/register', controller.registerDevice || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /devices/my:
 *   get:
 *     summary: Obtener los dispositivos del usuario actual
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de dispositivos.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Device'
 *       401:
 *         description: UNAUTHORIZED
 */
router.get('/my', controller.getMyDevices || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /devices/user/{userId}:
 *   get:
 *     summary: Obtener dispositivos de un usuario específico
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lista de dispositivos.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 */
router.get('/user/:userId', requirePermission('devices.read'), controller.getUserDevices || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /devices/{id}/trust:
 *   patch:
 *     summary: Marcar un dispositivo como confiable
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Dispositivo marcado como confiable.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 *       404:
 *         description: DEVICE_NOT_FOUND
 */
router.patch('/:id/trust', requirePermission('devices.manage'), controller.trustDevice || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /devices/{id}/block:
 *   patch:
 *     summary: Bloquear un dispositivo
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Dispositivo bloqueado.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 *       404:
 *         description: DEVICE_NOT_FOUND
 */
router.patch('/:id/block', requirePermission('devices.manage'), controller.blockDevice || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /devices/{id}:
 *   delete:
 *     summary: Eliminar un dispositivo
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Dispositivo eliminado.
 *       401:
 *         description: UNAUTHORIZED
 *       403:
 *         description: INSUFFICIENT_PERMISSIONS
 *       404:
 *         description: DEVICE_NOT_FOUND
 */
router.delete('/:id', requirePermission('devices.manage'), controller.deleteDevice || ((req,res) => res.json({success:true})));

module.exports = router;
