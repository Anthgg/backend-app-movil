const express = require('express');
const router = express.Router();
const { getDepartments } = require('./departments.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Departments
 *   description: Catálogo global de departamentos
 */

/**
 * @swagger
 * /api/departments:
 *   get:
 *     summary: Listar departamentos disponibles
 *     description: Retorna el catálogo global de departamentos para usar en selects del formulario de áreas.
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de departamentos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 *                       code:
 *                         type: string
 *                       is_active:
 *                         type: boolean
 */
router.get('/', requirePermission('areas.read'), getDepartments);

module.exports = router;
