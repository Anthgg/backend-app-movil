const express = require('express');
const router = express.Router();
const controller = require('./controllers');
const { authenticateToken } = require('../../shared/middlewares/auth.middleware');
const { tenantMiddleware } = require('../../shared/middlewares/tenant.middleware');

router.use(authenticateToken);
router.use(tenantMiddleware);

/**
 * @swagger
 * tags:
 *   name: Documents
 *   description: Worker documents for the mobile app
 */

/**
 * @swagger
 * /documents/my:
 *   get:
 *     summary: Get documents for the authenticated worker.
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Documents loaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     documents:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           type:
 *                             type: string
 *                             example: dni
 *                           title:
 *                             type: string
 *                             example: DNI
 *                           description:
 *                             type: string
 *                             nullable: true
 *                           status:
 *                             type: string
 *                             example: approved
 *                           fileUrl:
 *                             type: string
 *                             nullable: true
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           updatedAt:
 *                             type: string
 *                             format: date-time
 *                           reviewComment:
 *                             type: string
 *                             nullable: true
 *             examples:
 *               withDocuments:
 *                 value:
 *                   success: true
 *                   data:
 *                     documents:
 *                       - id: "11111111-1111-1111-1111-111111111111"
 *                         type: "dni"
 *                         title: "DNI"
 *                         description: "Documento nacional de identidad"
 *                         status: "approved"
 *                         fileUrl: "https://example.com/dni.pdf"
 *                         createdAt: "2026-05-07T16:30:00.000Z"
 *                         updatedAt: "2026-05-07T16:30:00.000Z"
 *                         reviewComment: null
 *               empty:
 *                 value:
 *                   success: true
 *                   data:
 *                     documents: []
 */
router.get('/my', controller.getMyDocuments);
router.get('/me', controller.getMyDocuments);
router.get('/worker/my', controller.getMyDocuments);
router.get('/my-documents', controller.getMyDocuments);
router.get('/', controller.getMyDocuments);

module.exports = router;
