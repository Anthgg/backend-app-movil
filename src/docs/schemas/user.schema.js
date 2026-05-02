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
 *           description: ID único del usuario.
 *         full_name:
 *           type: string
 *           description: Nombre completo del usuario.
 *         email:
 *           type: string
 *           format: email
 *           description: Correo electrónico del usuario.
 *         role:
 *           type: string
 *           description: Rol del usuario en el sistema.
 *         company_id:
 *           type: string
 *           format: uuid
 *           description: ID de la empresa a la que pertenece el usuario.
 *         is_active:
 *           type: boolean
 *           description: Estado de actividad del usuario.
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Fecha de creación del usuario.
 *         permissions:
 *           type: array
 *           items:
 *             type: string
 *           description: Lista de permisos del usuario.
 * 
 *     UserInput:
 *       type: object
 *       required:
 *         - full_name
 *         - email
 *         - password
 *         - role
 *       properties:
 *         full_name:
 *           type: string
 *           example: "Jane Doe"
 *         email:
 *           type: string
 *           format: email
 *           example: "jane.doe@example.com"
 *         password:
 *           type: string
 *           format: password
 *           example: "SecurePass123!"
 *         role:
 *           type: string
 *           description: "ID del rol a asignar"
 *           example: "admin"
 * 
 *     UserUpdate:
 *       type: object
 *       properties:
 *         full_name:
 *           type: string
 *           example: "Jane Doe Smith"
 *         email:
 *           type: string
 *           format: email
 *           example: "jane.smith@example.com"
 *         role:
 *           type: string
 *           description: "ID del rol a asignar"
 *           example: "editor"
 *         is_active:
 *           type: boolean
 *           example: false
 */
