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
      console.log('[profile/photo] multer-success', {
        fieldname: req.file?.fieldname || null,
        originalname: req.file?.originalname || null,
        mimetype: req.file?.mimetype || null,
        filename: req.file?.filename || null,
        size: req.file?.size || null
      });
      return next();
    }

    console.log('[profile/photo] multer-error', {
      message: error.message,
      code: error.code || null,
      statusCode: error.statusCode || null,
      field: error.field || null,
      details: error.details || null,
      contentType: req.headers['content-type'] || null
    });

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: 'La imagen excede el tamano maximo permitido.',
        error_code: 'FILE_TOO_LARGE'
      });
    }

    if (error.statusCode === 415) {
      return res.status(415).json({
        success: false,
        message: error.message,
        error_code: 'UNSUPPORTED_MEDIA_TYPE'
      });
    }

    return next(error);
  });
};

router.get('/me', controller.getMe);
router.get('/my-shift', controller.getMyShift);
router.put('/me', controller.updateMe);
router.post('/photo', handlePhotoUpload, controller.uploadPhoto);
router.delete('/photo', controller.deletePhoto);

module.exports = router;
