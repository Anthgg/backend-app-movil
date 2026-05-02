/**
 * @swagger
 * components:
 *   schemas:
 *     PayrollPeriod:
 *       type: object
 *       description: >
 *         Representa un periodo de planilla.
 *         ### Estados del Periodo:
 *         - **open**: Periodo recién creado, a la espera de generación de cálculos.
 *         - **generating**: Proceso asíncrono calculando la planilla.
 *         - **generated**: Cálculo completado. Listo para revisión. Puede ser recalculado.
 *         - **approved**: Revisado y aprobado por RRHH. Ya no se debe recalcular, pero sí se puede cerrar.
 *         - **closed**: Periodo cerrado definitivamente. No admite modificaciones ni recálculos.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *           example: "Planilla Mayo 2026"
 *         year:
 *           type: integer
 *           example: 2026
 *         month:
 *           type: integer
 *           example: 5
 *         start_date:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         end_date:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         status:
 *           type: string
 *           enum: [open, generating, generated, approved, closed]
 *           example: "open"
 *
 *     PayrollRecord:
 *       type: object
 *       description: Registro individual de planilla por trabajador en un periodo.
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         payroll_period_id:
 *           type: string
 *           format: uuid
 *         worker_id:
 *           type: string
 *           format: uuid
 *         gross_salary:
 *           type: number
 *           format: double
 *           description: "Salario bruto calculado en base a días trabajados y sueldo base."
 *         net_salary:
 *           type: number
 *           format: double
 *           description: "Salario neto final luego de deducciones e ingresos extra."
 *         total_deductions:
 *           type: number
 *           format: double
 *           description: "Total de deducciones aplicadas (ej: tardanzas, faltas)."
 *         total_earnings:
 *           type: number
 *           format: double
 *           description: "Total de ingresos extra aplicados."
 *
 *     PayrollAdjustment:
 *       type: object
 *       properties:
 *         concept:
 *           type: string
 *         amount:
 *           type: number
 *         type:
 *           type: string
 *           enum: [earning, deduction]
 *
 *     PayrollConcept:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *         type:
 *           type: string
 *           enum: [earning, deduction]
 *         is_fixed:
 *           type: boolean
 */
