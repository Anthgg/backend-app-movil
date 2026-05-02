/**
 * @swagger
 * components:
 *   schemas:
 *     Worker:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         full_name:
 *           type: string
 *         dni:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         phone_number:
 *           type: string
 *         address:
 *           type: string
 *         position_id:
 *           type: string
 *           format: uuid
 *         department_id:
 *           type: string
 *           format: uuid
 *         enterprise_id:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [active, inactive, on_leave]
 *         created_at:
 *           type: string
 *           format: date-time
 *
 *     CreateWorkerRequest:
 *       type: object
 *       required:
 *         - full_name
 *         - dni
 *         - email
 *         - position_id
 *         - department_id
 *       properties:
 *         full_name:
 *           type: string
 *         dni:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         phone_number:
 *           type: string
 *         address:
 *           type: string
 *         position_id:
 *           type: string
 *           format: uuid
 *         department_id:
 *           type: string
 *           format: uuid
 *
 *     UpdateWorkerRequest:
 *       type: object
 *       properties:
 *         full_name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         phone_number:
 *           type: string
 *         address:
 *           type: string
 *         position_id:
 *           type: string
 *           format: uuid
 *         department_id:
 *           type: string
 *           format: uuid
 *
 *     DniLookupResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             dni:
 *               type: string
 *             full_name:
 *               type: string
 */
