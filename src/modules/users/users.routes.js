const express = require('express');
const router = express.Router();
const usersController = require('./users.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

router.post('/create-worker', requirePermission('users.create'), usersController.createWorker);

module.exports = router;
