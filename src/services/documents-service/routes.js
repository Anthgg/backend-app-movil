const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { uploadRequestDocs } = require('../../shared/middlewares/uploadRequestDocs');
const { validateUuidParam } = require('../../utils/uuid.util');

const validateDocumentId = validateUuidParam('documentId', {
  field: 'documentId',
  errorCode: 'INVALID_DOCUMENT_ID',
  message: 'documentId invalido. Debe ser un UUID valido.'
});

const uploadWorkerDocs = uploadRequestDocs.fields([
  { name: 'file', maxCount: 1 },
  { name: 'document', maxCount: 1 },
  { name: 'documents', maxCount: 5 }
]);

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * Rutas móviles/autoservicio de documentos del trabajador autenticado.
 * Fuente única: worker_documents.
 */
router.get('/my', controller.getMyDocuments);
router.get('/me', controller.getMyDocuments);
router.get('/worker/my', controller.getMyDocuments);
router.get('/my-documents', controller.getMyDocuments);
router.post('/my', uploadWorkerDocs, controller.uploadMyDocuments);
router.post('/me', uploadWorkerDocs, controller.uploadMyDocuments);
router.delete('/my/:documentId', validateDocumentId, controller.deleteMyDocument);
router.delete('/me/:documentId', validateDocumentId, controller.deleteMyDocument);
router.get('/types', controller.getDocumentTypes);
router.get('/', controller.getMyDocuments);

module.exports = router;
