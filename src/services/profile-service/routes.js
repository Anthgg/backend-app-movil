const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { uploadProfilePhoto } = require('../../../shared/middlewares/upload.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/me', controller.getMe);
router.put('/me', controller.updateMe);
router.post('/photo', uploadProfilePhoto.single('photo'), controller.uploadPhoto);
router.delete('/photo', controller.deletePhoto);

module.exports = router;
