const express = require('express');
const router = express.Router();
const areaController = require('./areas.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');

/**
 * @swagger
 * tags:
 *   name: Areas
 *   description: Gestión de áreas laborales
 */

/**
 * @swagger
 * /api/areas:
 *   get:
 *     summary: Listar áreas activas de la empresa
 *     tags: [Areas]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de áreas con departamento y rol asociado
 */
router.get('/', requirePermission('areas.read'), areaController.getAreas);

/**
 * @swagger
 * /api/areas/by-department/{departmentId}:
 *   get:
 *     summary: Listar áreas activas de un departamento
 *     tags: [Areas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: departmentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Áreas del departamento
 */
router.get('/by-department/:departmentId', requirePermission('areas.read'), areaController.getAreasByDepartment);

/**
 * @swagger
 * /api/areas/{id}:
 *   get:
 *     summary: Obtener área por ID
 *     tags: [Areas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Detalle del área
 *       404:
 *         description: Área no encontrada
 */
router.get('/:id', requirePermission('areas.read'), areaController.getAreaById);

/**
 * @swagger
 * /api/areas:
 *   post:
 *     summary: Crear nueva área
 *     tags: [Areas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 150
 *                 example: Operaciones
 *               description:
 *                 type: string
 *                 nullable: true
 *                 example: Área encargada de la gestión operativa
 *               department_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: ID de un departamento existente
 *               role_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: ID de un rol existente del sistema
 *               is_active:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Área creada correctamente
 *       409:
 *         description: AREA_ALREADY_EXISTS
 *       422:
 *         description: DEPARTMENT_NOT_FOUND | ROLE_NOT_FOUND | VALIDATION_ERROR
 */
router.post('/', authorizeRoles('ADMIN', 'RRHH'), requirePermission('areas.create'), areaController.createArea);

/**
 * @swagger
 * /api/areas/{id}:
 *   put:
 *     summary: Actualizar área
 *     tags: [Areas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *                 nullable: true
 *               department_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               role_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Área actualizada correctamente
 */
router.put('/:id', authorizeRoles('ADMIN', 'RRHH'), requirePermission('areas.update'), areaController.updateArea);

/**
 * @swagger
 * /api/areas/{id}/status:
 *   patch:
 *     summary: Cambiar estado activo/inactivo del área
 *     tags: [Areas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               is_active:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       200:
 *         description: Estado actualizado
 */
router.patch('/:id/status', authorizeRoles('ADMIN', 'RRHH'), requirePermission('areas.update'), areaController.updateAreaStatus);

/**
 * @swagger
 * /api/areas/{id}:
 *   delete:
 *     summary: Eliminar área (soft delete)
 *     tags: [Areas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Área eliminada
 *       409:
 *         description: AREA_HAS_ACTIVE_JOB_POSITIONS
 */
router.delete('/:id', authorizeRoles('ADMIN', 'RRHH'), requirePermission('areas.delete'), areaController.deleteArea);

module.exports = router;
