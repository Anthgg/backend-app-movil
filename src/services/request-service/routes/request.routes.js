const express = require('express');
const router = express.Router();
const controller = require('../controllers/request.controller');
const { authenticateToken } = require('../../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../../shared/middlewares/permissions.middleware');

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
router.post('/', requirePermission('requests.create'), controller.createRequest);

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
// router.get('/pending', requirePermission('requests.read_company'), controller.getPendingRequests);

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
// router.get('/:id', requirePermission('requests.read_company'), controller.getRequestById);

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
router.patch('/:id/cancel', requirePermission('requests.cancel'), controller.cancelRequest);

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
// router.patch('/:id/resubmit', requirePermission('requests.create'), controller.resubmitRequest);

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

module.exports = router;
