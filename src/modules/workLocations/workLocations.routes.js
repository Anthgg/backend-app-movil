const express = require('express');
const router = express.Router();
const controller = require('./workLocations.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');

/**
 * @swagger
 * tags:
 *   name: WorkLocations
 *   description: Gestion de lugares fisicos de trabajo y radios GPS
 */

/**
 * @swagger
 * /api/work-locations:
 *   get:
 *     summary: Lista lugares de trabajo activos
 *     tags: [WorkLocations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Lugares de trabajo obtenidos correctamente
 *   post:
 *     summary: Crea un lugar de trabajo
 *     tags: [WorkLocations]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, address, geographic_department_id, geographic_province_id, geographic_district_id]
 *             properties:
 *               sede_id: { type: string, format: uuid, nullable: true }
 *               name: { type: string, example: "Obra Villa El Salvador" }
 *               address: { type: string, example: "Av. Principal 123" }
 *               geographic_department_id: { type: string, format: uuid }
 *               geographic_province_id: { type: string, format: uuid }
 *               geographic_district_id: { type: string, format: uuid }
 *               latitude: { type: number, example: -12.2145 }
 *               longitude: { type: number, example: -76.9432 }
 *               allowed_radius_meters: { type: integer, example: 100 }
 *     responses:
 *       201:
 *         description: Lugar de trabajo creado correctamente
 */
router.get('/', requirePermission('work_locations.read'), controller.getWorkLocations);
router.get('/places/search', requirePermission('work_locations.read'), controller.searchPlaces);
router.get('/places/reverse', requirePermission('work_locations.read'), controller.reverseGeocode);
router.get('/:id', requirePermission('work_locations.read'), controller.getWorkLocationById);
router.post('/', authorizeRoles('ADMIN', 'RRHH'), requirePermission('work_locations.create'), controller.createWorkLocation);
router.put('/:id', authorizeRoles('ADMIN', 'RRHH'), requirePermission('work_locations.update'), controller.updateWorkLocation);
router.patch('/:id/status', authorizeRoles('ADMIN', 'RRHH'), requirePermission('work_locations.update'), controller.updateWorkLocationStatus);
router.delete('/:id', authorizeRoles('ADMIN', 'RRHH'), requirePermission('work_locations.delete'), controller.deleteWorkLocation);

module.exports = router;
