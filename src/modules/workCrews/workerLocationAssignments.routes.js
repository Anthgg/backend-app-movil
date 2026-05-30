const express = require('express');
const router = express.Router();
const controller = require('./workCrews.controller');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');

router.patch('/:id/cancel', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.cancelWorkerLocationAssignment);

module.exports = router;
