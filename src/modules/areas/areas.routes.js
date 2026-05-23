const express = require('express');
const router = express.Router();
const areaController = require('./areas.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

// Middlewares - asumimos que el router principal inyecta auth y checkRole
// Si no, podemos inyectarlos acá. Depende de dónde se monte este router en app.js.

router.get('/', requirePermission('areas.read'), areaController.getAreas);
router.get('/:id', requirePermission('areas.read'), areaController.getAreaById);
router.post('/', requirePermission('areas.create'), areaController.createArea);
router.put('/:id', requirePermission('areas.update'), areaController.updateArea);
router.patch('/:id/status', requirePermission('areas.update'), areaController.updateAreaStatus);
router.delete('/:id', requirePermission('areas.delete'), areaController.deleteArea);

module.exports = router;
