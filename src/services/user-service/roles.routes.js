const express = require('express');
const router = express.Router();
const userController = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/', requirePermission('users.read'), userController.getRoles);

module.exports = router;
