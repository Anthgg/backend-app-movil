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
 *           nullable: true
 *           description: ID unico del trabajador.
 *         workerId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           description: ID real del trabajador en camelCase.
 *         user_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           description: ID del usuario asociado al trabajador.
 *         userId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *           description: ID del usuario asociado en camelCase.
 *         full_name:
 *           type: string
 *           nullable: true
 *           description: Nombre completo del trabajador.
 *         fullName:
 *           type: string
 *           nullable: true
 *           description: Nombre completo homologado.
 *         document_number:
 *           type: string
 *           nullable: true
 *         documentNumber:
 *           type: string
 *           nullable: true
 *           description: DNI o documento visible.
 *         personal_id:
 *           type: string
 *           nullable: true
 *           description: DNI o identificacion personal.
 *         email:
 *           type: string
 *           format: email
 *           nullable: true
 *         phone_number:
 *           type: string
 *           nullable: true
 *         phone:
 *           type: string
 *           nullable: true
 *           description: Telefono homologado.
 *         address:
 *           type: string
 *           nullable: true
 *         birth_date:
 *           type: string
 *           format: date
 *           nullable: true
 *         hire_date:
 *           type: string
 *           format: date
 *           nullable: true
 *         roleId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         roleName:
 *           type: string
 *           nullable: true
 *         roleCode:
 *           type: string
 *           nullable: true
 *         job_position_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         position_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         positionId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         positionName:
 *           type: string
 *           nullable: true
 *         areaId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         areaName:
 *           type: string
 *           nullable: true
 *         department_id:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         internalDepartmentId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         internalDepartmentName:
 *           type: string
 *           nullable: true
 *         workLocationId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         workLocationName:
 *           type: string
 *           nullable: true
 *         crewId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         crewName:
 *           type: string
 *           nullable: true
 *         status:
 *           type: string
 *           nullable: true
 *         profileStatus:
 *           type: string
 *           enum: [complete, incomplete]
 *         isProfileComplete:
 *           type: boolean
 *         is_active:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
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
