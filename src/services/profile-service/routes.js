const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { uploadProfilePhoto } = require('../../shared/middlewares/upload.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

const handlePhotoUpload = (req, res, next) => {
  uploadProfilePhoto.single('photo')(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'La imagen excede el tamaño máximo permitido.', error_code: 'FILE_TOO_LARGE' });
    }

    if (error.statusCode === 415) {
      return res.status(415).json({ success: false, message: error.message, error_code: 'UNSUPPORTED_MEDIA_TYPE' });
    }

    return next(error);
  });
};

router.get('/me', controller.getMe);
router.put('/me', controller.updateMe);
router.post('/photo', handlePhotoUpload, controller.uploadPhoto);
router.delete('/photo', controller.deletePhoto);

module.exports = router;
