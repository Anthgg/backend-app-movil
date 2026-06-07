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
 *         workerId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         userId:
 *           type: string
 *           format: uuid
 *           nullable: true
 *         fullName:
 *           type: string
 *           nullable: true
 *         documentNumber:
 *           type: string
 *           nullable: true
 *         full_name:
 *           type: string
 *         dni:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         phone_number:
 *           type: string
 *         phone:
 *           type: string
 *           nullable: true
 *         address:
 *           type: string
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
 *         position_id:
 *           type: string
 *           format: uuid
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
 *         enterprise_id:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum: [active, inactive, on_leave]
 *         created_at:
 *           type: string
 *           format: date-time
 *         profileStatus:
 *           type: string
 *           enum: [complete, incomplete]
 *         isProfileComplete:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
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
