/**
 * @swagger
 * components:
 *   schemas:
 *     AttendanceAnalyticsMetrics:
 *       type: object
 *       description: Metricas calculadas por el backend. El cliente no debe recalcularlas.
 *       properties:
 *         totalWorkers: { type: integer, example: 80 }
 *         scheduledWorkDays: { type: integer, example: 1920 }
 *         presentCount: { type: integer, example: 1480, description: Incluye asistencias puntuales y tardanzas. }
 *         onTimeCount: { type: integer, example: 1300 }
 *         presentOnTimeCount: { type: integer, example: 1300 }
 *         lateCount: { type: integer, example: 180 }
 *         absentCount: { type: integer, example: 90 }
 *         vacationCount: { type: integer, example: 60 }
 *         medicalLeaveCount: { type: integer, example: 20 }
 *         unpaidLeaveCount: { type: integer, example: 10 }
 *         holidayCount: { type: integer, example: 1 }
 *         restDayCount: { type: integer, example: 320 }
 *         noScheduleCount: { type: integer, example: 4 }
 *         incompleteCount: { type: integer, example: 2 }
 *         pendingCount: { type: integer, example: 12 }
 *         workedMinutes: { type: integer, example: 710400 }
 *         lateMinutes: { type: integer, example: 2500 }
 *         overtimeMinutes: { type: integer, example: 1200 }
 *         attendanceRate: { type: number, format: double, example: 88.1 }
 *         punctualityRate: { type: number, format: double, example: 82.4 }
 *         absenceRate: { type: number, format: double, example: 5.3 }
 *         lateRate: { type: number, format: double, example: 12.1 }
 *         averageLateMinutes: { type: number, format: double, example: 13.89 }
 *         completedShiftRate: { type: number, format: double, example: 97.5 }
 *         score: { type: number, format: double, minimum: 0, maximum: 100, example: 91.2 }
 *     AttendanceAnalyticsRankingItem:
 *       allOf:
 *         - $ref: '#/components/schemas/AttendanceAnalyticsMetrics'
 *         - type: object
 *           properties:
 *             rank: { type: integer, example: 1 }
 *             label: { type: string, example: Carlos Mendoza }
 *             workerId: { type: string, format: uuid }
 *             userId: { type: string, format: uuid, nullable: true }
 *             fullName: { type: string, example: Carlos Mendoza }
 *             documentNumber: { type: string, example: "70000001" }
 *             profilePhotoUrl: { type: string, nullable: true }
 *             photoUrl: { type: string, nullable: true }
 *             avatarUrl: { type: string, nullable: true }
 *             areaName: { type: string, example: Produccion }
 *             positionName: { type: string, example: Operario }
 *             departmentName: { type: string, example: Operaciones }
 *             workLocationName: { type: string, example: Obra Norte }
 *             crewName: { type: string, example: Cuadrilla A }
 *             lastLateAt: { type: string, format: date, nullable: true }
 *             lastAbsenceAt: { type: string, format: date, nullable: true }
 *             value: { type: number, example: 8 }
 *             secondaryValue: { type: string, example: 130 min tarde }
 *     AttendanceAnalyticsStatusSlice:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           enum: [present, late, absent, vacation, medical_leave, unpaid_leave, holiday, rest_day, no_schedule, incomplete, pending]
 *         label: { type: string, example: Vacaciones }
 *         value: { type: integer, example: 35 }
 *         percentage: { type: number, format: double, example: 2.1 }
 *     AttendanceAnalyticsDashboard:
 *       type: object
 *       required: [period, filters, kpis, rankings, charts, generatedAt]
 *       properties:
 *         period:
 *           type: string
 *           example: 2026-06
 *         dateRange:
 *           type: object
 *           properties:
 *             startDate: { type: string, format: date }
 *             endDate: { type: string, format: date }
 *             month: { type: string, nullable: true, example: 2026-06 }
 *         filters: { type: object, additionalProperties: true }
 *         kpis: { $ref: '#/components/schemas/AttendanceAnalyticsMetrics' }
 *         rankings:
 *           type: object
 *           properties:
 *             topAbsentWorkers: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             topLateWorkers: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             bestAttendanceWorkers: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             bestPunctualityWorkers: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             topAbsentAreas: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             topLateAreas: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             bestAttendanceAreas: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             topAbsentWorkLocations: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             topLateWorkLocations: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             bestAttendanceWorkLocations: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             topAbsentCrews: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             topLateCrews: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *             bestAttendanceCrews: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsRankingItem' } }
 *         charts:
 *           type: object
 *           properties:
 *             statusDistribution: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsStatusSlice' } }
 *             dailyTrend: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsMetrics' } }
 *             weeklyTrend: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsMetrics' } }
 *             byArea: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsMetrics' } }
 *             byDepartment: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsMetrics' } }
 *             byWorkLocation: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsMetrics' } }
 *             byCrew: { type: array, items: { $ref: '#/components/schemas/AttendanceAnalyticsMetrics' } }
 *         generatedAt: { type: string, format: date-time }
 */
