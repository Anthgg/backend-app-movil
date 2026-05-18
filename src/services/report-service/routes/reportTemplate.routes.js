const express = require('express');
const router = express.Router();
const controller = require('../controllers/reportTemplate.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

router.post('/', controller.createTemplate);
router.get('/', controller.getTemplates);
router.get('/:id', controller.getTemplateById);
router.put('/:id', controller.updateTemplate);
router.delete('/:id', controller.deleteTemplate);

module.exports = router;
