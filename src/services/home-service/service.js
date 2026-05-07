const { query } = require('../../../config/database');
const birthdayService = require('../birthday-service/service');
const moment = require('moment');

class HomeService {
    async getSummary(userId, tenantId) {
        // 1. Datos básicos del usuario y trabajador
        const userRes = await query(`
            SELECT 
                u.id, (u.first_name || ' ' || u.last_name) as full_name,
                w.id as worker_id, w.profile_photo_url, w.birth_date,
                jp.title as position
            FROM users u
            LEFT JOIN workers w ON u.id = w.user_id
            LEFT JOIN job_positions jp ON w.job_position_id = jp.id
            WHERE u.id = $1 AND u.company_id = $2
        `, [userId, tenantId]);

        if (userRes.rows.length === 0) throw new Error('Usuario no encontrado.');
        const userData = userRes.rows[0];

        const today = moment();
        const isBirthday = userData.birth_date && 
            moment(userData.birth_date).month() === today.month() && 
            moment(userData.birth_date).date() === today.date();

        // 2. Asistencia del día
        const attendanceRes = await query(`
            SELECT * FROM attendance_records 
            WHERE worker_id = $1 AND date = CURRENT_DATE
        `, [userData.worker_id]);
        
        const todayAttendance = attendanceRes.rows[0] || null;

        // 3. Estadísticas del mes
        const statsRes = await query(`
            SELECT 
                COUNT(*) as worked_days,
                SUM(hours_worked) as total_hours
            FROM attendance_records
            WHERE worker_id = $1 
            AND date >= DATE_TRUNC('month', CURRENT_DATE)
            AND date <= CURRENT_DATE
        `, [userData.worker_id]);

        const stats = statsRes.rows[0];

        // 4. Cumpleaños del día y próximos
        const todayBirthdays = await birthdayService.getTodayBirthdays(tenantId);
        const upcomingBirthdays = await birthdayService.getUpcomingBirthdays(tenantId);

        // Formatear respuesta
        return {
            user: {
                id: userData.id,
                fullName: userData.full_name,
                profilePhotoUrl: userData.profile_photo_url,
                birthDate: userData.birth_date,
                isBirthday: !!isBirthday,
                position: userData.position
            },
            attendance: {
                hasCheckedIn: !!(todayAttendance && todayAttendance.check_in_time),
                hasCheckedOut: !!(todayAttendance && todayAttendance.check_out_time),
                todayStatus: todayAttendance ? todayAttendance.status : 'pending',
                workedHoursToday: todayAttendance && todayAttendance.hours_worked ? `${todayAttendance.hours_worked}h` : '0h',
                workedDaysMonth: parseInt(stats.worked_days || 0),
                workedHoursMonth: `${parseFloat(stats.total_hours || 0).toFixed(1)}h`
            },
            birthdays: {
                today: todayBirthdays.filter(b => b.id !== userData.worker_id), // Excluir al propio usuario si es su cumple
                upcoming: upcomingBirthdays
            },
            message: isBirthday ? `¡Feliz cumpleaños, ${userData.full_name.split(' ')[0]}!` : `¡Hola, ${userData.full_name.split(' ')[0]}!`
        };
    }
}

module.exports = new HomeService();
