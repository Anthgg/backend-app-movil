const express = require('express');
const router = express.Router();
const ubigeoController = require('./ubigeo.controller');

/**
 * @swagger
 * tags:
 *   name: Geography
 *   description: Catalogos ubigeo de Peru
 */

/**
 * @swagger
 * /api/geography/departments:
 *   get:
 *     summary: Lista departamentos geograficos
 *     tags: [Geography]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Departamentos obtenidos correctamente
 * /api/geography/provinces:
 *   get:
 *     summary: Lista provincias por departamento geografico
 *     tags: [Geography]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: department_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Provincias obtenidas correctamente
 * /api/geography/districts:
 *   get:
 *     summary: Lista distritos por provincia
 *     tags: [Geography]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: province_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Distritos obtenidos correctamente
 */
router.get('/departments', ubigeoController.getDepartments);
router.get('/provinces/:departmentId', ubigeoController.getProvincesByDepartment);
router.get('/districts/:provinceId', ubigeoController.getDistrictsByProvince);
router.get('/provinces', ubigeoController.getProvincesByDepartment);
router.get('/districts', ubigeoController.getDistrictsByProvince);

module.exports = router;
