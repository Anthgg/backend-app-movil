const express = require('express');
const router = express.Router();
const multer = require('multer');
const companySettingsController = require('./companySettings.controller');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo se permiten JPG, PNG, WEBP y SVG.'));
    }
  }
});

router.use(authenticateToken);

// Solo ADMIN, SUPER_ADMIN y RRHH deberían poder editar la config.
// La lectura puede ser general si se requiere, pero por seguridad, la limitaremos.
// En caso de que se necesite en un futuro acceso de lectura para trabajadores, se puede habilitar con permisos.

// GET /api/company-settings
router.get('/', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), companySettingsController.getSettings);

// PUT /api/company-settings
router.put('/', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), companySettingsController.upsertSettings);

// POST & DELETE /api/company-settings/logo
router.post('/logo', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), uploadMemory.single('file'), companySettingsController.uploadLogo);
router.delete('/logo', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), companySettingsController.deleteLogo);

// POST & DELETE /api/company-settings/signature
router.post('/signature', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), uploadMemory.single('file'), companySettingsController.uploadSignature);
router.delete('/signature', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), companySettingsController.deleteSignature);

// POST & DELETE /api/company-settings/stamp
router.post('/stamp', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), uploadMemory.single('file'), companySettingsController.uploadStamp);
router.delete('/stamp', authorizeRoles('ADMIN', 'SUPER_ADMIN', 'RRHH'), companySettingsController.deleteStamp);

module.exports = router;
