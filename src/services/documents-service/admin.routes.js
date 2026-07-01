const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');
const { uploadWorkerDocument } = require('../../shared/middlewares/uploadWorkerDocument');
const { validateUuidParam } = require('../../utils/uuid.util');

const validateDocumentId = validateUuidParam('documentId', {
  field: 'documentId',
  errorCode: 'INVALID_DOCUMENT_ID',
  message: 'documentId invalido. Debe ser un UUID valido.'
});
const validateWorkerId = validateUuidParam('workerId', {
  field: 'workerId',
  errorCode: 'INVALID_WORKER_ID',
  message: 'workerId invalido. Debe ser un UUID valido.'
});

router.use(authenticateToken);
router.use(tenantMiddleware);

router.get('/types', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getAdminDocumentTypes);
router.get('/', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), controller.getCompanyDocuments);
router.get('/:documentId', authorizeRoles('ADMIN', 'RRHH', 'SUPERVISOR'), validateDocumentId, controller.getDocumentDetail);
router.post('/workers/:workerId', authorizeRoles('ADMIN', 'RRHH'), validateWorkerId, uploadWorkerDocument, controller.uploadWorkerDocuments);
router.patch('/:documentId/review', authorizeRoles('ADMIN', 'RRHH'), validateDocumentId, controller.reviewDocument);
router.delete('/:documentId', authorizeRoles('ADMIN', 'RRHH'), validateDocumentId, controller.deleteDocument);

module.exports = router;
