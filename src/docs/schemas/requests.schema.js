/**
 * @swagger
 * components:
 *   schemas:
 *     EmployeeRequest:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         worker_id:
 *           type: string
 *           format: uuid
 *         request_type_id:
 *           type: string
 *           format: uuid
 *         start_date:
 *           type: string
 *           format: date
 *         end_date:
 *           type: string
 *           format: date
 *         reason:
 *           type: string
 *         status:
 *           type: string
 *           enum: [draft, pending, pending_supervisor, pending_rrhh, observed, approved, rejected, cancelled, expired]
 *         statusLabel:
 *           type: string
 *           example: Aprobada
 *         status_key:
 *           type: string
 *           example: approved
 *         document_urls:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *
 *     CreateRequest:
 *       type: object
 *       required:
 *         - request_type_id
 *         - start_date
 *         - end_date
 *         - reason
 *       properties:
 *         request_type_id:
 *           type: string
 *           format: uuid
 *         start_date:
 *           type: string
 *           format: date
 *         end_date:
 *           type: string
 *           format: date
 *         reason:
 *           type: string
 *         document_urls:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *
 *     ApproveRequest:
 *       type: object
 *       properties:
 *         approver_notes:
 *           type: string
 *
 *     RejectRequest:
 *       type: object
 *       required:
 *         - reason
 *       properties:
 *         reason:
 *           type: string
 *
 *     ObserveRequest:
 *       type: object
 *       required:
 *         - observation
 *       properties:
 *         observation:
 *           type: string
 */
