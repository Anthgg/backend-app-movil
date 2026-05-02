/**
 * @swagger
 * components:
 *   schemas:
 *     JobRun:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         job_name:
 *           type: string
 *           description: "Nombre del trabajo (ej: generate-absences)"
 *         trigger_type:
 *           type: string
 *           enum: [auto, manual]
 *           description: "Indica si fue ejecutado por cron o manualmente."
 *         target_date:
 *           type: string
 *           format: date
 *           description: "Fecha objetivo del procesamiento."
 *         status:
 *           type: string
 *           enum: [running, success, failed]
 *         total_processed:
 *           type: integer
 *         total_success:
 *           type: integer
 *         total_failed:
 *           type: integer
 *         started_at:
 *           type: string
 *           format: date-time
 *         completed_at:
 *           type: string
 *           format: date-time
 *         error_message:
 *           type: string
 */