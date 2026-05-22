const express = require('express');
const router = express.Router();
const usersController = require('./users.controller');

router.post('/create-worker', usersController.createWorker);

module.exports = router;
