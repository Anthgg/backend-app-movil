const express = require('express');
const router = express.Router();
const departmentController = require('./departments.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');

/**
 * @swagger
 * tags:
 *   name: Departments
 *   description: Gestion de departamentos internos de la empresa
 */

/**
 * @swagger
 * /api/departments:
 *   get:
 *     summary: Lista departamentos internos activos
 *     tags: [Departments]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Departamentos obtenidos correctamente
 *   post:
 *     summary: Crea un departamento interno
 *     tags: [Departments]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Operaciones" }
 *               description: { type: string, nullable: true }
 *               is_active: { type: boolean, example: true }
 *     responses:
 *       201:
 *         description: Departamento creado correctamente
 */
router.get('/', requirePermission('departments.read'), departmentController.getDepartments);
router.get('/:id', requirePermission('departments.read'), departmentController.getDepartmentById);
router.post('/', authorizeRoles('ADMIN', 'RRHH'), requirePermission('departments.create'), departmentController.createDepartment);
router.put('/:id', authorizeRoles('ADMIN', 'RRHH'), requirePermission('departments.update'), departmentController.updateDepartment);
router.patch('/:id/status', authorizeRoles('ADMIN', 'RRHH'), requirePermission('departments.update'), departmentController.updateDepartmentStatus);
router.delete('/:id', authorizeRoles('ADMIN', 'RRHH'), requirePermission('departments.delete'), departmentController.deleteDepartment);

module.exports = router;
