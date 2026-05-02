/**
 * @swagger
 * components:
 *   schemas:
 *     Shift:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         start_time:
 *           type: string
 *           format: time
 *         end_time:
 *           type: string
 *           format: time
 *         tolerance_minutes:
 *           type: integer
 *         work_days:
 *           type: array
 *           items:
 *             type: integer
 *           description: "Días de trabajo (0 = Domingo, 1 = Lunes...)"
 *         is_rotative:
 *           type: boolean
 *         is_night_shift:
 *           type: boolean
 *         is_active:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *
 *     ShiftInput:
 *       type: object
 *       required:
 *         - name
 *         - start_time
 *         - end_time
 *         - work_days
 *       properties:
 *         name:
 *           type: string
 *         start_time:
 *           type: string
 *           format: time
 *         end_time:
 *           type: string
 *           format: time
 *         tolerance_minutes:
 *           type: integer
 *         work_days:
 *           type: array
 *           items:
 *             type: integer
 *         is_rotative:
 *           type: boolean
 *         is_night_shift:
 *           type: boolean
 */
