const express = require('express');
const router = express.Router();
const areaController = require('./areas.controller');

// Middlewares - asumimos que el router principal inyecta auth y checkRole
// Si no, podemos inyectarlos acá. Depende de dónde se monte este router en app.js.

router.get('/', areaController.getAreas);
router.get('/:id', areaController.getAreaById);
router.post('/', areaController.createArea);
router.put('/:id', areaController.updateArea);
router.patch('/:id/status', areaController.updateAreaStatus);

module.exports = router;
