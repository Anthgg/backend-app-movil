const express = require('express');
const router = express.Router();
const userController = require('./controllers');
const onboardingController = require('../onboarding-service/controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User administration
 */

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * /users/my/notifications:
 *   get:
 *     summary: Obtener mis notificaciones
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de notificaciones devuelta.
 */
router.get('/my/notifications', userController.getMyNotifications);
router.get('/roles', requirePermission('users.read'), userController.getRoles);

/**
 * @swagger
 * /users/suggest-credentials:
 *   post:
 *     summary: Sugiere username y correo corporativo para un colaborador.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [company_id, first_name, paternal_last_name]
 *             properties:
 *               company_id: { type: string, format: uuid }
 *               first_name: { type: string }
 *               paternal_last_name: { type: string }
 *               maternal_last_name: { type: string }
 *     responses:
 *       200:
 *         description: Identificadores sugeridos sin exponer contrasena temporal.
 *       403:
 *         description: Tenant o permisos invalidos.
 *       422:
 *         description: Datos invalidos o dominio corporativo faltante.
 */
router.post('/suggest-credentials', requirePermission('users.create'), onboardingController.suggestCredentials);

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get a list of users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A list of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
router.get('/', requirePermission('users.read'), userController.getAllUsers);

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 */
router.post('/', requirePermission('users.create'), userController.createUser);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get a user by ID
 *     tags: [Users]
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
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.get('/:id', requirePermission('users.read'), userController.getUserById);

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Update a user by ID
 *     tags: [Users]
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
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.put('/:id', requirePermission('users.update'), userController.updateUser);

/**
 * @swagger
 * /users/{id}/disable:
 *   patch:
 *     summary: Disable a user
 *     tags: [Users]
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
 *         description: User disabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserStatusResponse'
 */
router.patch('/:id/disable', requirePermission('users.disable'), userController.disableUser);

/**
 * @swagger
 * /users/{id}/enable:
 *   patch:
 *     summary: Enable a user
 *     tags: [Users]
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
 *         description: User enabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserStatusResponse'
 */
router.patch('/:id/enable', requirePermission('users.enable'), userController.enableUser);

/**
 * @swagger
 * /users/{id}/block:
 *   patch:
 *     summary: Block a user
 *     tags: [Users]
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
 *         description: User blocked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserStatusResponse'
 */
router.patch('/:id/block', requirePermission('users.block'), userController.blockUser);

/**
 * @swagger
 * /users/{id}/suspend:
 *   patch:
 *     summary: Suspend a user
 *     tags: [Users]
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
 *         description: User suspended
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserStatusResponse'
 */
router.patch('/:id/suspend', requirePermission('users.suspend'), userController.suspendUser);

/**
 * @swagger
 * /users/{id}/status:
 *   get:
 *     summary: Get user status
 *     tags: [Users]
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
 *         description: User status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserStatusResponse'
 */
router.get('/:id/status', requirePermission('users.read'), userController.getStatus);

router.post('/export/pdf', requirePermission('users.export'), userController.exportUsersPdf);
router.post('/export/excel', requirePermission('users.export'), userController.exportUsersExcel);

module.exports = router;
