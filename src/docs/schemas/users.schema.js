/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         full_name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         role_id:
 *           type: string
 *           format: uuid
 *         enterprise_id:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [active, inactive, suspended, blocked]
 *         created_at:
 *           type: string
 *           format: date-time
 *
 *     CreateUserRequest:
 *       type: object
 *       required:
 *         - full_name
 *         - email
 *         - password
 *         - role_id
 *       properties:
 *         full_name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           format: password
 *         role_id:
 *           type: string
 *           format: uuid
 *
 *     UpdateUserRequest:
 *       type: object
 *       properties:
 *         full_name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         role_id:
 *           type: string
 *           format: uuid
 *
 *     UserStatusResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: object
 *           properties:
 *             user_id:
 *               type: string
 *               format: uuid
 *             status:
 *               type: string
 *               enum: [active, inactive, suspended, blocked, disabled, enabled]
 */
