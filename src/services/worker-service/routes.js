const express = require('express');
const router = express.Router();
const workerController = require('./controllers');
const attendanceController = require('../attendance-service/controllers/attendance.controller');
const onboardingController = require('../onboarding-service/controllers');
const contractController = require('../contract-service/controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { authorizeRoles } = require('../../shared/middlewares/roles.middleware');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');
const { signedContractUpload } = require('../../utils/file-upload.util');

/**
 * @swagger
 * tags:
 *   name: Workers
 *   description: Worker and employee management
 */

router.use(authenticateToken);

/**
 * @swagger
 * /workers/me:
 *   get:
 *     summary: Obtener mi perfil completo de trabajador
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil devuelto.
 */
router.get('/me', workerController.getMe);

/**
 * @swagger
 * /workers/me:
 *   put:
 *     summary: Actualizar mi información de contacto
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
 *               phone: { type: string }
 *               address: { type: string }
 *               personalEmail: { type: string }
 *     responses:
 *       200:
 *         description: Perfil actualizado.
 */
router.put('/me', workerController.updateMe);

/**
 * @swagger
 * /workers/vacations/balance:
 *   get:
 *     summary: Obtener mi saldo de vacaciones
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saldo devuelto.
 */
router.get('/vacations/balance', workerController.getVacationBalance);

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
 * /workers/onboarding:
 *   post:
 *     summary: Alta integral de colaborador.
 *     tags: [Workers, Onboarding]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Colaborador creado correctamente.
 */
router.post('/onboarding', authorizeRoles('ADMIN', 'RRHH'), onboardingController.onboardWorker);

/**
 * @swagger
 * /workers/{workerId}/onboarding-status:
 *   get:
 *     summary: Obtiene el estado del alta integral de un colaborador.
 *     tags: [Workers, Onboarding]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Estado de onboarding.
 */
router.get('/:workerId/onboarding-status', requirePermission('workers.read'), onboardingController.getOnboardingStatus);

/**
 * @swagger
 * /workers/{workerId}/contracts/signed:
 *   post:
 *     summary: Sube el contrato firmado de un colaborador.
 *     tags: [Workers, Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: workerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, contract_id]
 *             properties:
 *               file: { type: string, format: binary }
 *               contract_id: { type: string, format: uuid }
 *               signed_at: { type: string, format: date }
 *               observations: { type: string }
 *     responses:
 *       200:
 *         description: Contrato firmado subido correctamente.
 */
router.get('/:id/contracts', requirePermission('workers.read'), contractController.listContracts);

router.post(
  '/:id/contracts/generate',
  authorizeRoles('ADMIN', 'RRHH'),
  contractController.generateContract
);

router.post(
  '/:workerId/contracts/signed',
  authorizeRoles('ADMIN', 'RRHH'),
  signedContractUpload.single('file'),
  contractController.uploadSignedContract
);

router.get('/companies', authorizeRoles('ADMIN', 'RRHH'), workerController.getCompaniesCatalog);
router.get('/branches', authorizeRoles('ADMIN', 'RRHH'), workerController.getBranchesCatalog);
router.get('/areas', authorizeRoles('ADMIN', 'RRHH'), workerController.getAreasCatalog);
router.get('/positions', authorizeRoles('ADMIN', 'RRHH'), workerController.getPositionsCatalog);
router.get('/types', authorizeRoles('ADMIN', 'RRHH'), workerController.getWorkerTypesCatalog);
router.get('/shifts', authorizeRoles('ADMIN', 'RRHH'), workerController.getShiftsCatalog);
router.get('/supervisors', authorizeRoles('ADMIN', 'RRHH'), workerController.getSupervisorsCatalog);

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
 * /workers/{id}/attendance:
 *   get:
 *     summary: Obtener el historial de asistencia de un trabajador por su ID
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Historial de asistencia devuelto.
 */
router.get('/:id/attendance', requirePermission('attendance.read'), attendanceController.getWorkerRecords);

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
 * /workers/{id}/labor-assignment:
 *   patch:
 *     summary: Actualiza la asignacion laboral del trabajador
 *     tags: [Workers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sede_id: { type: string, format: uuid, nullable: true }
 *               internal_department_id: { type: string, format: uuid }
 *               area_id: { type: string, format: uuid }
 *               position_id: { type: string, format: uuid }
 *               work_location_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Asignacion laboral actualizada correctamente.
 */
router.patch('/:id/labor-assignment', authorizeRoles('ADMIN', 'RRHH'), requirePermission('workers.update'), workerController.updateLaborAssignment);

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
