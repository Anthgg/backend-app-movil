const express = require('express');
const controller = require('../controllers/request.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../../shared/middlewares/permissions.middleware');

const router = express.Router();

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/me/balance', controller.getMyVacationBalance);
router.get('/workers/:workerId/balance', requirePermission('requests.read_company'), controller.getWorkerVacationBalance);

module.exports = router;
