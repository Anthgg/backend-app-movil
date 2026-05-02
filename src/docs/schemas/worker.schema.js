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
 *           description: ID único del trabajador.
 *         user_id:
 *           type: string
 *           format: uuid
 *           description: ID del usuario asociado al trabajador.
 *         full_name:
 *           type: string
 *           description: Nombre completo del trabajador (sincronizado desde users).
 *         email:
 *           type: string
 *           format: email
 *           description: Email del trabajador (sincronizado desde users).
 *         personal_id:
 *           type: string
 *           description: DNI o identificación personal.
 *         phone_number:
 *           type: string
 *           description: Número de teléfono.
 *         address:
 *           type: string
 *           description: Dirección de residencia.
 *         birth_date:
 *           type: string
 *           format: date
 *           description: Fecha de nacimiento.
 *         hire_date:
 *           type: string
 *           format: date
 *           description: Fecha de contratación.
 *         job_position_id:
 *           type: string
 *           format: uuid
 *           description: ID del cargo del trabajador.
 *         department_id:
 *           type: string
 *           format: uuid
 *           description: ID del departamento del trabajador.
 *         is_active:
 *           type: boolean
 *           description: Indica si el trabajador está activo.
 *         created_at:
 *           type: string
 *           format: date-time
 *
 *     WorkerInput:
 *       type: object
 *       required:
 *         - user_id
 *         - personal_id
 *         - hire_date
 *         - job_position_id
 *       properties:
 *         user_id:
 *           type: string
 *           format: uuid
 *           description: ID del usuario a convertir en trabajador.
 *         personal_id:
 *           type: string
 *           example: "12345678A"
 *         phone_number:
 *           type: string
 *           example: "+34600123456"
 *         address:
 *           type: string
 *           example: "Calle Falsa 123"
 *         birth_date:
 *           type: string
 *           format: date
 *           example: "1990-01-15"
 *         hire_date:
 *           type: string
 *           format: date
 *           example: "2023-03-01"
 *         job_position_id:
 *           type: string
 *           format: uuid
 *         department_id:
 *           type: string
 *           format: uuid
 *
 *     WorkerUpdate:
 *       type: object
 *       properties:
 *         personal_id:
 *           type: string
 *         phone_number:
 *           type: string
 *         address:
 *           type: string
 *         birth_date:
 *           type: string
 *           format: date
 *         job_position_id:
 *           type: string
 *           format: uuid
 *         department_id:
 *           type: string
 *           format: uuid
 *         is_active:
 *           type: boolean
 */