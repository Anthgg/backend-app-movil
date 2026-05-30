const express = require('express');
const router = express.Router();
const controller = require('./workCrews.controller');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');

router.get('/', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getWorkCrews);
router.post('/', authorizeRoles('ADMIN', 'RRHH'), controller.createWorkCrew);
router.get('/:id', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getWorkCrewById);
router.put('/:id', authorizeRoles('ADMIN', 'RRHH'), controller.updateWorkCrew);
router.patch('/:id/status', authorizeRoles('ADMIN', 'RRHH'), controller.updateWorkCrewStatus);
router.put('/:id/work-location', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.updateWorkCrewLocation);

router.get('/:id/workers', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getCrewWorkers);
router.post('/:id/workers', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.addWorkersToCrew);
router.delete('/:id/workers/:workerId', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.removeWorkerFromCrew);

module.exports = router;
