const express = require('express');
const router = express.Router();
const controller = require('./workCrews.controller');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');
const { validateUuidParam } = require('../../utils/uuid.util');

const validateCrewId = validateUuidParam('id', {
  field: 'crewId',
  errorCode: 'INVALID_CREW_ID',
  message: 'crewId invalido. Debe ser un UUID valido.'
});
const validateWorkerId = validateUuidParam('workerId', {
  field: 'workerId',
  errorCode: 'INVALID_WORKER_ID',
  message: 'workerId invalido. Debe ser un UUID valido.'
});

router.get('/', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getWorkCrews);
router.post('/', authorizeRoles('ADMIN', 'RRHH'), controller.createWorkCrew);
router.get('/:id', validateCrewId, authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getWorkCrewById);
router.put('/:id', validateCrewId, authorizeRoles('ADMIN', 'RRHH'), controller.updateWorkCrew);
router.patch('/:id/status', validateCrewId, authorizeRoles('ADMIN', 'RRHH'), controller.updateWorkCrewStatus);
router.put('/:id/work-location', validateCrewId, authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.updateWorkCrewLocation);

router.get('/:id/workers', validateCrewId, authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getCrewWorkers);
router.post('/:id/workers', validateCrewId, authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.addWorkersToCrew);
router.delete('/:id/workers/:workerId', validateCrewId, validateWorkerId, authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.removeWorkerFromCrew);

module.exports = router;
