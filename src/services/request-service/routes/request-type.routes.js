const express = require('express');
const router = express.Router();
const controller = require('../controllers/request.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/', controller.getRequestTypes);
router.get('/active', controller.getRequestTypes);

module.exports = router;
