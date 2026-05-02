/**
 * @swagger
 * components:
 *   schemas:
 *     DashboardSummary:
 *       type: object
 *       properties:
 *         total_workers: { type: integer }
 *         active_workers: { type: integer }
 *         attendance_today:
 *           type: object
 *           properties:
 *             present: { type: integer }
 *             late: { type: integer }
 *             absent: { type: integer }
 *             incomplete: { type: integer }
 *         pending_requests: { type: integer }
 *         contracts_expiring_soon: { type: integer }
 */
