const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/summary', controller.getSummary);

module.exports = router;
