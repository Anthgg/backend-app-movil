const { query } = require('../../config/database');
const birthdayService = require('../birthday-service/service');
const { getWorkerShift, serializeAttendanceRecord, formatDateOnly, TIMEZONE } = require('../attendance-service/services/mobile-attendance.service');

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

function getPrimaryName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'colaborador';
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

    let shift = null;
    let attendance = {
      hasCheckedIn: false,
      hasCheckedOut: false,
      todayStatus: 'not_started',
      workedHoursToday: '00h 00m',
      workedDaysMonth: 0,
      workedHoursMonth: '00h 00m',
      today: serializeAttendanceRecord(null, { shift: null })
    };

    if (user.worker_id) {
      shift = await getWorkerShift(user.worker_id, tenantId);

      const [todayAttendanceRes, monthStatsRes] = await Promise.all([
        query(`
          SELECT ar.*
          FROM attendance_records ar
          WHERE ar.worker_id = $1
            AND ar.company_id = $2
            AND ar.date = CURRENT_DATE
          ORDER BY ar.created_at DESC
          LIMIT 1
        `, [user.worker_id, tenantId]),
        query(`
          SELECT
            COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) AS worked_days_month,
            COALESCE(SUM(COALESCE(worked_hours, hours_worked, worked_minutes::numeric / 60.0, 0)), 0) AS worked_hours_month
          FROM attendance_records
          WHERE worker_id = $1
            AND company_id = $2
            AND date >= DATE_TRUNC('month', CURRENT_DATE)::date
            AND date <= CURRENT_DATE
        `, [user.worker_id, tenantId])
      ]);

      const todayRow = todayAttendanceRes.rows[0] || null;
      const monthRow = monthStatsRes.rows[0] || {};
      const normalizedToday = serializeAttendanceRecord(todayRow, {
        todayDate: formatDateOnly(new Date()),
        shift
      });

      attendance = {
        hasCheckedIn: !!normalizedToday.checkIn,
        hasCheckedOut: !!normalizedToday.checkOut,
        todayStatus: normalizedToday.attendanceStatus === 'none' ? 'not_started' : normalizedToday.attendanceStatus,
        workedHoursToday: formatHours(normalizedToday.workedHours),
        workedDaysMonth: parseInt(monthRow.worked_days_month || 0, 10),
        workedHoursMonth: formatHours(monthRow.worked_hours_month || 0),
        today: normalizedToday
      };
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
        isBirthday,
        shift
      },
      birthdayGreeting: {
        show: isBirthday,
        message: isBirthday ? `Feliz cumpleanos, ${getPrimaryName(user.full_name)}!` : null
      },
      shift,
      attendance,
      birthdays: {
        today: todayBirthdays.filter((item) => item.id !== user.user_id),
        upcoming: upcomingBirthdays.filter((item) => item.id !== user.user_id)
      },
      message: isBirthday ? `Feliz cumpleaños, ${user.full_name.split(' ')[0]}!` : `Hola, ${user.full_name.split(' ')[0]}!`
    };
  }
}

module.exports = new HomeService();
