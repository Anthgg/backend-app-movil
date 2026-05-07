const { query } = require('../../../config/database');
const moment = require('moment-timezone');

const TIMEZONE = process.env.TZ || 'America/Lima';

function formatHours(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
}

class SummaryService {
    async getTodayAttendance(workerId, tenantId) {
        const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
        const res = await query(
            `SELECT ar.*, s.name as shift_name, s.start_time, s.end_time, s.tolerance_minutes as shift_tolerance
             FROM attendance_records ar
             LEFT JOIN shifts s ON ar.shift_id = s.id
             WHERE ar.worker_id = $1 AND ar.company_id = $2 AND ar.date = $3
             ORDER BY ar.created_at DESC LIMIT 1`,
            [workerId, tenantId, today]
        );

        if (res.rows.length === 0) {
            // Si no hay marcación, intentar obtener el turno asignado
            const shiftRes = await query(
                `SELECT s.* FROM shifts s
                 JOIN workers w ON w.shift_id = s.id
                 WHERE w.id = $1 AND w.company_id = $2`,
                [workerId, tenantId]
            );
            const shift = shiftRes.rows[0];

            return {
                attendanceDate: today,
                shift: shift ? {
                    id: shift.id,
                    name: shift.name,
                    startTime: shift.start_time,
                    endTime: shift.end_time,
                    toleranceMinutes: shift.tolerance_minutes
                } : null,
                checkInTime: null,
                checkOutTime: null,
                attendanceStatus: null,
                statusLabel: 'Sin marcar',
                lateMinutes: 0,
                workedMinutes: 0,
                overtimeMinutes: 0,
                earlyLeaveMinutes: 0,
                canCheckIn: !!shift,
                canCheckOut: false
            };
        }

        const row = res.rows[0];
        const statusLabels = {
            on_time: 'A tiempo',
            tolerance: 'Dentro de tolerancia',
            late: 'Tardanza',
            completed: 'Completado',
            early_leave: 'Salida anticipada',
            completed_overtime: 'Completado con extras'
        };

        return {
            attendanceDate: row.date,
            shift: {
                id: row.shift_id,
                name: row.shift_name,
                startTime: row.start_time,
                endTime: row.end_time,
                toleranceMinutes: row.shift_tolerance
            },
            checkInTime: row.check_in_time ? moment(row.check_in_time).tz(TIMEZONE).format('HH:mm') : null,
            checkOutTime: row.check_out_time ? moment(row.check_out_time).tz(TIMEZONE).format('HH:mm') : null,
            attendanceStatus: row.attendance_status || row.status,
            statusLabel: statusLabels[row.final_status || row.attendance_status || row.status] || 'Registrado',
            lateMinutes: row.late_minutes || 0,
            workedMinutes: row.worked_minutes || 0,
            overtimeMinutes: row.overtime_minutes || 0,
            earlyLeaveMinutes: row.early_leave_minutes || 0,
            canCheckIn: false,
            canCheckOut: !row.check_out_time
        };
    }

    async getMonthSummary(workerId, tenantId) {
        const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
        const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');

        const res = await query(
            `SELECT 
                COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) as worked_days,
                SUM(worked_minutes) as total_worked_minutes,
                SUM(overtime_minutes) as total_overtime_minutes,
                COUNT(*) FILTER (WHERE attendance_status = 'late') as late_count,
                SUM(late_minutes) as total_late_minutes,
                COUNT(*) FILTER (WHERE final_status = 'early_leave') as early_leave_count
             FROM attendance_records
             WHERE worker_id = $1 AND company_id = $2 AND date >= $3 AND date <= $4`,
            [workerId, tenantId, startOfMonth, endOfMonth]
        );

        const row = res.rows[0];
        return {
            workedDaysMonth: parseInt(row.worked_days || 0, 10),
            workedMinutesMonth: parseInt(row.total_worked_minutes || 0, 10),
            workedHoursMonth: formatHours(parseInt(row.total_worked_minutes || 0, 10)),
            overtimeMinutesMonth: parseInt(row.total_overtime_minutes || 0, 10),
            overtimeHoursMonth: formatHours(parseInt(row.total_overtime_minutes || 0, 10)),
            lateCountMonth: parseInt(row.late_count || 0, 10),
            lateMinutesMonth: parseInt(row.total_late_minutes || 0, 10),
            earlyLeaveCountMonth: parseInt(row.early_leave_count || 0, 10)
        };
    }
}

module.exports = new SummaryService();
