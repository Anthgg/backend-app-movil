/**
 * @swagger
 * components:
 *   schemas:
 *     Device:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         worker_id:
 *           type: string
 *           format: uuid
 *         device_id:
 *           type: string
 *           description: Identificador único de hardware o instalación.
 *         device_name:
 *           type: string
 *         brand:
 *           type: string
 *         model:
 *           type: string
 *         os_version:
 *           type: string
 *         app_version:
 *           type: string
 *         push_token:
 *           type: string
 *         is_trusted:
 *           type: boolean
 *         is_blocked:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *
 *     DeviceInput:
 *       type: object
 *       required:
 *         - device_id
 *         - device_name
 *         - os_version
 *       properties:
 *         device_id:
 *           type: string
 *         device_name:
 *           type: string
 *         brand:
 *           type: string
 *         model:
 *           type: string
 *         os_version:
 *           type: string
 *         app_version:
 *           type: string
 *         push_token:
 *           type: string
 */