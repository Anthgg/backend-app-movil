const express = require('express');
const router = express.Router();
const workerController = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Workers
 *   description: Worker and employee management
 */

router.use(authenticateToken);

/**
 * @swagger
 * /workers:
 *   get:
 *     summary: Get a list of workers
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of workers
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Worker'
 */
router.get('/', requirePermission('workers.read'), workerController.getAllWorkers);

/**
 * @swagger
 * /workers:
 *   post:
 *     summary: Create a new worker
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateWorkerRequest'
 *     responses:
 *       201:
 *         description: Worker created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Worker'
 */
router.post('/', requirePermission('workers.create'), workerController.createWorker);

/**
 * @swagger
 * /workers/{id}:
 *   get:
 *     summary: Get a worker by ID
 *     tags: [Workers]
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
 *       200:
 *         description: Worker found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Worker'
 *       404:
 *         description: Worker not found
 */
router.get('/:id', requirePermission('workers.read'), workerController.getWorkerById);

/**
 * @swagger
 * /workers/{id}:
 *   put:
 *     summary: Update a worker by ID
 *     tags: [Workers]
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
 *             $ref: '#/components/schemas/UpdateWorkerRequest'
 *     responses:
 *       200:
 *         description: Worker updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Worker'
 *       404:
 *         description: Worker not found
 */
router.put('/:id', requirePermission('workers.update'), workerController.updateWorker);

/**
 * @swagger
 * /workers/{id}/disable:
 *   patch:
 *     summary: Disable a worker
 *     tags: [Workers]
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
 *       200:
 *         description: Worker disabled
 */
router.patch('/:id/disable', authorizeRoles('ADMIN', 'RRHH'), workerController.disableWorker);

/**
 * @swagger
 * /workers/{id}/enable:
 *   patch:
 *     summary: Enable a worker
 *     tags: [Workers]
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
 *       200:
 *         description: Worker enabled
 */
router.patch('/:id/enable', authorizeRoles('ADMIN', 'RRHH'), workerController.enableWorker);

/**
 * @swagger
 * /workers/dni/{dni}:
 *   get:
 *     summary: Get worker by DNI
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dni
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Worker found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Worker'
 *       404:
 *         description: Worker not found
 */
// router.get('/dni/:dni', authorizeRoles('ADMIN', 'RRHH'), workerController.getWorkerByDni);

/**
 * @swagger
 * /workers/lookup-dni:
 *   post:
 *     summary: Lookup DNI information from an external service
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dni:
 *                 type: string
 *     responses:
 *       200:
 *         description: DNI information retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DniLookupResponse'
 */
router.post('/lookup-dni', authorizeRoles('ADMIN', 'RRHH'), workerController.lookupDni);


module.exports = router;
