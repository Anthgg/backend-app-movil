/**
 * @swagger
 * components:
 *   schemas:
 *     ReportFilters:
 *       type: object
 *       properties:
 *         start_date:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         end_date:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         worker_id:
 *           type: string
 *           format: uuid
 *         project_id:
 *           type: string
 *           format: uuid
 *         department_id:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *         request_type_id:
 *           type: string
 *           format: uuid
 *         job_position_id:
 *           type: string
 *           format: uuid
 *         page:
 *           type: integer
 *           default: 1
 *         limit:
 *           type: integer
 *           default: 10
 *         sort_by:
 *           type: string
 *         sort_order:
 *           type: string
 *           enum: [asc, desc]
 *
 *     AttendanceReportRow:
 *       type: object
 *       properties:
 *         worker_id:
 *           type: string
 *           format: uuid
 *         worker_name:
 *           type: string
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
 *         hours_worked:
 *           type: number
 *
 *     AbsenceReportRow:
 *       type: object
 *       properties:
 *         worker_id:
 *           type: string
 *           format: uuid
 *         worker_name:
 *           type: string
 *         date:
 *           type: string
 *           format: date
 *         reason:
 *           type: string
 *         is_justified:
 *           type: boolean
 *
 *     LateReportRow:
 *       type: object
 *       properties:
 *         worker_id:
 *           type: string
 *           format: uuid
 *         worker_name:
 *           type: string
 *         date:
 *           type: string
 *           format: date
 *         check_in:
 *           type: string
 *           format: date-time
 *         minutes_late:
 *           type: integer
 *
 *     RequestReportRow:
 *       type: object
 *       properties:
 *         request_id:
 *           type: string
 *           format: uuid
 *         worker_name:
 *           type: string
 *         request_type:
 *           type: string
 *         status:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *
 *     VacationReportRow:
 *       type: object
 *       properties:
 *         worker_id:
 *           type: string
 *           format: uuid
 *         worker_name:
 *           type: string
 *         start_date:
 *           type: string
 *           format: date
 *         end_date:
 *           type: string
 *           format: date
 *         days_taken:
 *           type: integer
 *         status:
 *           type: string
 *
 *     MedicalLeaveReportRow:
 *       type: object
 *       properties:
 *         worker_id:
 *           type: string
 *           format: uuid
 *         worker_name:
 *           type: string
 *         start_date:
 *           type: string
 *           format: date
 *         end_date:
 *           type: string
 *           format: date
 *         diagnosis:
 *           type: string
 *         doctor_name:
 *           type: string
 *
 *     WorkerReportRow:
 *       type: object
 *       properties:
 *         worker_id:
 *           type: string
 *           format: uuid
 *         first_name:
 *           type: string
 *         last_name:
 *           type: string
 *         document_number:
 *           type: string
 *         job_position:
 *           type: string
 *         hire_date:
 *           type: string
 *           format: date
 *         status:
 *           type: string
 *
 *     MonthlySummaryRow:
 *       type: object
 *       properties:
 *         worker_id:
 *           type: string
 *           format: uuid
 *         worker_name:
 *           type: string
 *         month:
 *           type: integer
 *         year:
 *           type: integer
 *         days_worked:
 *           type: integer
 *         absences:
 *           type: integer
 *         late_arrivals:
 *           type: integer
 *         total_hours:
 *           type: number
 *
 *     GeneratedReport:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             type: object
 *         metadata:
 *           type: object
 *           properties:
 *             generated_at:
 *               type: string
 *               format: date-time
 *             total_records:
 *               type: integer
 *             filters_applied:
 *               $ref: '#/components/schemas/ReportFilters'
 */
