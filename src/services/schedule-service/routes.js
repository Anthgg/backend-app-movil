const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Shifts
 *   description: Configuración de turnos (fijos, rotativos, nocturnos) y tolerancia
 */

router.use(authenticateToken);

/**
 * @swagger
 * /shifts:
 *   get:
 *     summary: Obtener lista de turnos
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de turnos.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Shift'
 */
router.get('/', requirePermission('shifts.read'), (req, res) => res.json({ success: true }));

/**
 * @swagger
 * /shifts:
 *   post:
 *     summary: Crear un nuevo turno
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShiftInput'
 *     responses:
 *       201:
 *         description: Turno creado.
 */
router.post('/', requirePermission('shifts.manage'), (req, res) => res.json({ success: true }));

/**
 * @swagger
 * /shifts/{id}:
 *   get:
 *     summary: Obtener un turno por ID
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Detalles del turno.
 */
router.get('/:id', requirePermission('shifts.read'), (req, res) => res.json({ success: true }));

/**
 * @swagger
 * /shifts/{id}:
 *   put:
 *     summary: Actualizar un turno existente
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShiftInput'
 *     responses:
 *       200:
 *         description: Turno actualizado.
 */
router.put('/:id', requirePermission('shifts.manage'), (req, res) => res.json({ success: true }));

/**
 * @swagger
 * /shifts/{id}/disable:
 *   patch:
 *     summary: Desactivar un turno
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Turno desactivado.
 */
router.patch('/:id/disable', requirePermission('shifts.manage'), (req, res) => res.json({ success: true }));

/**
 * @swagger
 * /shifts/{id}/enable:
 *   patch:
 *     summary: Activar un turno
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Turno activado.
 */
router.patch('/:id/enable', requirePermission('shifts.manage'), (req, res) => res.json({ success: true }));

/**
 * @swagger
 * /shifts/{id}:
 *   delete:
 *     summary: Eliminar un turno permanentemente
 *     tags: [Shifts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Turno eliminado.
 */
router.delete('/:id', requirePermission('shifts.manage'), (req, res) => res.json({ success: true }));

module.exports = router;
