const { query } = require('../../config/database');
const birthdayService = require('../birthday-service/service');
const moment = require('moment-timezone');

const TIMEZONE = process.env.TZ || 'America/Lima';


function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function formatHours(value) {
  const numeric = Number(value || 0);
  const totalMinutes = Math.max(Math.round(numeric * 60), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

function normalizeRole(roles = []) {
  const primary = (roles[0] || 'WORKER').toUpperCase();
  const map = {
    TRABAJADOR: 'worker',
    WORKER: 'worker',
    ADMIN: 'admin',
    RRHH: 'rrhh',
    SUPERVISOR: 'supervisor'
  };
  return map[primary] || primary.toLowerCase();
}

class HomeService {
  async getSummary(userId, tenantId, roles = []) {
    const userRes = await query(`
      SELECT
        u.id AS user_id,
        CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
        w.id AS worker_id,
        w.profile_photo_url,
        w.birth_date
      FROM users u
      LEFT JOIN workers w
        ON w.user_id = u.id
       AND w.company_id = u.company_id
       AND w.deleted_at IS NULL
      WHERE u.id = $1
        AND u.company_id = $2
        AND u.deleted_at IS NULL
      LIMIT 1
    `, [userId, tenantId]);

    if (userRes.rows.length === 0) {
      const err = new Error('Usuario no encontrado.');
      err.statusCode = 404;
      throw err;
    }

    const user = userRes.rows[0];
    const today = new Date();
    const birthDate = user.birth_date ? new Date(user.birth_date) : null;
    const isBirthday = !!birthDate &&
      birthDate.getUTCMonth() === today.getUTCMonth() &&
      birthDate.getUTCDate() === today.getUTCDate();

    let summary_shift = null;
    let attendance = {

      hasCheckedIn: false,
      hasCheckedOut: false,
      todayStatus: 'not_started',
      workedHoursToday: '00h 00m',
      workedDaysMonth: 0,
      workedHoursMonth: '00h 00m'
    };

    if (user.worker_id) {
      const todayAttendanceRes = await query(`
        SELECT ar.*, s.name as shift_name, s.start_time, s.end_time, s.tolerance_minutes as shift_tolerance
        FROM attendance_records ar
        LEFT JOIN shifts s ON ar.shift_id = s.id
        WHERE ar.worker_id = $1
          AND ar.company_id = $2
          AND ar.date = CURRENT_DATE
        ORDER BY ar.created_at DESC
        LIMIT 1
      `, [user.worker_id, tenantId]);

      const monthStatsRes = await query(`
        SELECT
          COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) AS worked_days_month,
          SUM(COALESCE(worked_minutes, 0)) AS worked_minutes_month,
          SUM(COALESCE(overtime_minutes, 0)) AS overtime_minutes_month,
          COUNT(*) FILTER (WHERE attendance_status = 'late') AS late_count_month
        FROM attendance_records
        WHERE worker_id = $1
          AND company_id = $2
          AND date >= DATE_TRUNC('month', CURRENT_DATE)::date
          AND date <= CURRENT_DATE
      `, [user.worker_id, tenantId]);

      const todayRow = todayAttendanceRes.rows[0];
      const monthRow = monthStatsRes.rows[0] || {};

      const statusLabels = {
        on_time: 'A tiempo',
        tolerance: 'Dentro de tolerancia',
        late: 'Tardanza',
        completed: 'Completado',
        early_leave: 'Salida anticipada',
        completed_overtime: 'Completado con extras'
      };

      attendance = {
        hasCheckedIn: !!todayRow?.check_in_time,
        hasCheckedOut: !!todayRow?.check_out_time,
        todayStatus: todayRow?.final_status || todayRow?.attendance_status || (todayRow?.check_in_time ? 'working' : 'not_started'),
        statusLabel: statusLabels[todayRow?.final_status || todayRow?.attendance_status] || (todayRow?.check_in_time ? 'En curso' : 'Sin marcar'),
        checkInTime: todayRow?.check_in_time ? moment(todayRow.check_in_time).tz(TIMEZONE).format('HH:mm') : null,
        checkOutTime: todayRow?.check_out_time ? moment(todayRow.check_out_time).tz(TIMEZONE).format('HH:mm') : null,
        lateMinutes: todayRow?.late_minutes || 0,
        workedHoursToday: formatHours(todayRow?.worked_minutes || 0),
        overtimeToday: formatHours(todayRow?.overtime_minutes || 0),
        workedDaysMonth: parseInt(monthRow.worked_days_month || 0, 10),
        workedHoursMonth: formatHours(monthRow.worked_minutes_month || 0),
        overtimeMonth: formatHours(monthRow.overtime_minutes_month || 0),
        lateCountMonth: parseInt(monthRow.late_count_month || 0, 10),
        canCheckIn: !todayRow?.check_in_time,
        canCheckOut: !!todayRow?.check_in_time && !todayRow?.check_out_time
      };

      // Obtener turno si no hay marcación hoy
      if (!todayRow) {
        const shiftRes = await query(
            `SELECT s.* FROM shifts s
             JOIN workers w ON w.shift_id = s.id
             WHERE w.id = $1 AND w.company_id = $2`,
            [user.worker_id, tenantId]
        );
        const shift = shiftRes.rows[0];
        if (shift) {
            summary_shift = {
                id: shift.id,
                name: shift.name,
                startTime: shift.start_time,
                endTime: shift.end_time,
                toleranceMinutes: shift.tolerance_minutes
            };
        }
      } else {
        summary_shift = {
            id: todayRow.shift_id,
            name: todayRow.shift_name,
            startTime: todayRow.start_time,
            endTime: todayRow.end_time,
            toleranceMinutes: todayRow.shift_tolerance
        };
      }
    }

    const [todayBirthdays, upcomingBirthdays] = await Promise.all([
      birthdayService.getTodayBirthdays(tenantId),
      birthdayService.getUpcomingBirthdays(tenantId)
    ]);

    return {
      user: {
        id: user.user_id,
        fullName: user.full_name,
        role: normalizeRole(roles),
        profilePhotoUrl: user.profile_photo_url || null,
        birthDate: formatDateOnly(user.birth_date),
        isBirthday
      },
      shift: summary_shift,
      attendance,
      birthdays: {
        today: todayBirthdays.filter((item) => item.id !== user.user_id),
        upcoming: upcomingBirthdays.filter((item) => item.id !== user.user_id)
      },
      message: isBirthday ? `¡Feliz cumpleaños, ${user.full_name.split(' ')[0]}!` : `Hola, ${user.full_name.split(' ')[0]}!`
    };
  }
}

module.exports = new HomeService();
