/**
 * @swagger
 * components:
 *   schemas:
 *     AttendanceRecord:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         worker_id:
 *           type: string
 *           format: uuid
 *         project_id:
 *           type: string
 *           format: uuid
 *         shift_id:
 *           type: string
 *           format: uuid
 *         date:
 *           type: string
 *           format: date
 *         check_in:
 *           type: string
 *           format: date-time
 *         check_out:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [present, late, absent, incomplete, observed, rejected, corrected, justified_absence]
 *         check_in_location:
 *           type: object
 *           properties:
 *             latitude: { type: number }
 *             longitude: { type: number }
 *             accuracy: { type: number }
 *             is_mock_location: { type: boolean }
 *         check_out_location:
 *           type: object
 *           properties:
 *             latitude: { type: number }
 *             longitude: { type: number }
 *             accuracy: { type: number }
 *             is_mock_location: { type: boolean }
 *         check_in_photo:
 *           type: string
 *         check_out_photo:
 *           type: string
 *         hours_worked:
 *           type: number
 *         overtime_hours:
 *           type: number
 *         minutes_late:
 *           type: integer
 *         corrections:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               corrected_by: { type: string, format: uuid }
 *               reason: { type: string }
 *               created_at: { type: string, format: date-time }
 * 
 *     CheckInRequest:
 *       type: object
 *       required:
 *         - latitude
 *         - longitude
 *       properties:
 *         latitude:
 *           type: number
 *         longitude:
 *           type: number
 *         accuracy:
 *           type: number
 *           description: Precisión del GPS en metros.
 *         is_mock_location:
 *           type: boolean
 *           description: Indica si se detectó un fake GPS.
 *         device_id:
 *           type: string
 *         project_id:
 *           type: string
 *           format: uuid
 *         photo_url:
 *           type: string
 *           description: Evidencia fotográfica.
 * 
 *     CheckOutRequest:
 *       type: object
 *       required:
 *         - latitude
 *         - longitude
 *       properties:
 *         latitude:
 *           type: number
 *         longitude:
 *           type: number
 *         accuracy:
 *           type: number
 *         is_mock_location:
 *           type: boolean
 *         device_id:
 *           type: string
 *         photo_url:
 *           type: string
 * 
 *     AttendanceCorrectionRequest:
 *       type: object
 *       required:
 *         - check_in
 *         - check_out
 *         - reason
 *       properties:
 *         check_in:
 *           type: string
 *           format: date-time
 *         check_out:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [present, late, absent, corrected]
 *         reason:
 *           type: string
 *           description: Motivo de la corrección
 */
