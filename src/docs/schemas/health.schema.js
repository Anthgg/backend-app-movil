/**
 * @swagger
 * components:
 *   schemas:
 *     HealthResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           example: "ok"
 *         timestamp:
 *           type: string
 *           format: date-time
 *         services:
 *           type: object
 *           properties:
 *             db:
 *               type: string
 *               example: "ok"
 *             supabase:
 *               type: string
 *               example: "ok"
 *             backend:
 *               type: string
 *               example: "ok"
 *         uptime:
 *           type: number
 *           example: 3600
 */
