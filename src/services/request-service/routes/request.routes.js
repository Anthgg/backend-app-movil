const express = require('express');
const router = express.Router();
const controller = require('../controllers/request.controller');
const documentController = require('../controllers/requestDocument.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../../shared/middlewares/permissions.middleware');
const { uploadRequestDocs } = require('../../../shared/middlewares/uploadRequestDocs');

const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (req.user?.roles?.includes('ADMIN')) {
    return next();
  }

  const userPermissions = req.user?.permissions || [];
  const hasPermission = permissions.some((permission) => userPermissions.includes(permission));

  if (!hasPermission) {
    return res.status(403).json({
      success: false,
      message: `Acceso denegado: falta alguno de los permisos [${permissions.join(', ')}]`
    });
  }

  next();
};

/**
 * @swagger
 * tags:
 *   name: Requests
 *   description: Employee requests (vacations, leaves, etc.)
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * /requests:
 *   post:
 *     summary: Create a new employee request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRequest'
 *           examples:
 *             CreateRequestExample:
 *               $ref: '#/components/examples/CreateRequestExample'
 *     responses:
 *       '201':
 *         description: Request created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmployeeRequest'
 */
router.post('/', requirePermission('requests.create'), uploadRequestDocs.array('documents', 5), controller.createRequest);
router.get('/types', controller.getRequestTypes);
router.get('/request-types', controller.getRequestTypes);

/**
 * @swagger
 * /requests/my:
 *   get:
 *     summary: Get all requests for the current user.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: A list of the current user's requests.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EmployeeRequest'
 */
router.get('/my', requirePermission('requests.read_own'), controller.getMyRequests);

/**
 * @swagger
 * /requests/pending:
 *   get:
 *     summary: Get all pending requests for the company.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: A list of pending requests.
 */
router.get('/pending', requirePermission('requests.read_company'), controller.getPendingRequests);

/**
 * @swagger
 * /requests:
 *   get:
 *     summary: Get all requests for the company.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: A list of all requests.
 */
router.get('/', requirePermission('requests.read_company'), controller.getCompanyRequests || ((req,res) => res.json({success:true})));

// ==========================================
// REPORTS ROUTES
// ==========================================
router.get('/reports/columns', controller.getAvailableReportColumns);
router.get('/reports', requirePermission('requests.read_company'), controller.getRequestsReport);
router.get('/reports/export/excel', requirePermission('requests.read_company'), controller.exportRequestsExcel);
router.get('/reports/export/pdf', requirePermission('requests.read_company'), controller.exportRequestsPdf);
router.get('/reports/export/csv', requirePermission('requests.read_company'), controller.exportRequestsCsv);

// Nuevos endpoints de reportes, previsualización, exportación dinámica, gráficos y resúmenes
router.post('/reports/preview', requireAnyPermission('requests.read_company', 'requests.read_own'), controller.previewRequestsReport);
router.post('/reports/export/excel', requireAnyPermission('requests.read_company', 'requests.read_own'), controller.exportRequestsExcelPost);
router.post('/reports/export/pdf', requireAnyPermission('requests.read_company', 'requests.read_own'), controller.exportRequestsPdfPost);
router.post('/reports/export/csv', requireAnyPermission('requests.read_company', 'requests.read_own'), controller.exportRequestsCsvPost);
router.post('/reports/charts', requireAnyPermission('requests.read_company', 'requests.read_own'), controller.getRequestsCharts);
router.post('/reports/summary', requireAnyPermission('requests.read_company', 'requests.read_own'), controller.getRequestsSummary);
router.get('/reports/summary', requireAnyPermission('requests.read_company', 'requests.read_own'), controller.getRequestsSummary);

// ==========================================
// TEMPLATES ROUTES
// ==========================================
router.get('/templates', requirePermission('requests.templates.read'), controller.listTemplates);
router.get('/templates/:id/download', requirePermission('requests.templates.read'), controller.downloadTemplate);
router.post('/templates', requirePermission('requests.templates.write'), uploadRequestDocs.single('template'), controller.createTemplate);
router.patch('/templates/:id', requirePermission('requests.templates.write'), uploadRequestDocs.single('template'), controller.updateTemplate);
router.delete('/templates/:id', requirePermission('requests.templates.write'), controller.deactivateTemplate);

/**
 * @swagger
 * /requests/{id}:
 *   get:
 *     summary: Get a specific request by ID.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Request details.
 *       '404':
 *         description: Request not found.
 */
router.get('/:id', controller.getRequestById);
router.put('/:id', requirePermission('requests.update_own'), uploadRequestDocs.array('documents', 5), controller.updateRequest);
router.patch('/:id', requirePermission('requests.update_own'), uploadRequestDocs.array('documents', 5), controller.updateRequest);
router.delete('/:id', requirePermission('requests.cancel_own'), controller.cancelRequest);
router.post('/:id/cancel', requirePermission('requests.cancel_own'), controller.cancelRequest);

/**
 * @swagger
 * /requests/{id}/cancel:
 *   patch:
 *     summary: Cancel a request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Request cancelled.
 */
router.patch('/:id/cancel', requirePermission('requests.cancel_own'), controller.cancelRequest);
router.post('/:id/review', requireAnyPermission('requests.approve', 'requests.reject', 'requests.observe'), controller.reviewRequest);

/**
 * @swagger
 * /requests/{id}/observe:
 *   patch:
 *     summary: Add an observation to a request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ObserveRequest'
 *     responses:
 *       '200':
 *         description: Observation added.
 */
router.patch('/:id/observe', requirePermission('requests.observe'), controller.observeRequest || ((req,res) => res.json({success:true})));

/**
 * @swagger
 * /requests/{id}/resubmit:
 *   patch:
 *     summary: Resubmit a request that was observed.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Request resubmitted.
 */
router.patch('/:id/resubmit', requirePermission('requests.create'), uploadRequestDocs.array('documents', 5), controller.resubmitRequest);

/**
 * @swagger
 * /requests/{id}/approve:
 *   patch:
 *     summary: Approve a request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ApproveRequest'
 *     responses:
 *       '200':
 *         description: Request approved.
 */
router.patch('/:id/approve', requirePermission('requests.approve'), controller.approveRequest);

/**
 * @swagger
 * /requests/{id}/reject:
 *   patch:
 *     summary: Reject a request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RejectRequest'
 *     responses:
 *       '200':
 *         description: Request rejected.
 */
router.patch('/:id/reject', requirePermission('requests.reject'), controller.rejectRequest);

// ==========================================
// DOCUMENT ROUTES (Upload, List, Delete)
// ==========================================

/**
 * @swagger
 * /requests/{id}/documents:
 *   post:
 *     summary: Upload documents to a request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               documents:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Up to 5 files (PDF, Word, Excel, images). Max 10MB each.
 *               documentType:
 *                 type: string
 *                 description: Optional document type label.
 *     responses:
 *       '201':
 *         description: Documents uploaded successfully.
 *       '400':
 *         description: No files attached.
 *       '404':
 *         description: Request not found.
 *       '415':
 *         description: Unsupported file type.
 */
router.post('/:id/documents', requirePermission('requests.create'), uploadRequestDocs.array('documents', 5), documentController.uploadDocuments);

/**
 * @swagger
 * /requests/{id}/documents:
 *   get:
 *     summary: List all documents of a request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: List of documents.
 *       '404':
 *         description: Request not found.
 */
router.get('/:id/documents', documentController.getDocuments);

/**
 * @swagger
 * /requests/{id}/documents/{docId}:
 *   delete:
 *     summary: Delete a document from a request.
 *     tags: [Requests]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: Document deleted.
 *       '404':
 *         description: Document not found.
 */
router.delete('/:id/documents/:docId', requirePermission('requests.cancel_own'), documentController.deleteDocument);

module.exports = router;
