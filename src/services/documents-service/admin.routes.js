const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getCompanyDocuments);

module.exports = router;
