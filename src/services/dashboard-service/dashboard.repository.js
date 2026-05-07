const { query } = require('../../config/database');
const birthdayService = require('../birthday-service/service');
const { getWorkerShift, serializeAttendanceRecord } = require('../attendance-service/services/mobile-attendance.service');

function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function isBirthdayToday(value, now = new Date()) {
  if (!value) {
    return false;
  }

  const birthDate = new Date(value);
  return birthDate.getUTCMonth() === now.getUTCMonth()
    && birthDate.getUTCDate() === now.getUTCDate();
}

async function getVacationBalance(workerId) {
  const tableCheck = await query(
    `SELECT to_regclass('public.worker_vacation_balances') AS table_name`
  );

  if (!tableCheck.rows[0]?.table_name) {
    return null;
  }

  const result = await query(
    `SELECT accumulated_days, used_days, pending_days
     FROM worker_vacation_balances
     WHERE worker_id = $1`,
    [workerId]
  );

  return result.rows[0] || null;
}

class DashboardRepository {
  async getSummaryMetrics(companyId) {
    const workersRes = await query(
      `SELECT COUNT(*) FROM workers
       WHERE company_id = $1
         AND is_active = true
         AND hire_date <= CURRENT_DATE
         AND deleted_at IS NULL`,
      [companyId]
    );

    const usersRes = await query(
      `SELECT
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) as inactive_users
       FROM users
       WHERE company_id = $1
         AND deleted_at IS NULL`,
      [companyId]
    );

    const devicesRes = await query(
      `SELECT COUNT(*) FROM user_devices ud
       JOIN users u ON ud.user_id = u.id
       WHERE u.company_id = $1
         AND ud.is_blocked = true`,
      [companyId]
    );

    const contractsRes = await query(
      `SELECT COUNT(*) FROM worker_contracts wc
       JOIN workers w ON wc.worker_id = w.id
       WHERE w.company_id = $1
         AND wc.status = 'ACTIVE'
         AND wc.end_date <= (NOW() + INTERVAL '30 days')`,
      [companyId]
    );

    return {
      activeWorkers: parseInt(workersRes.rows[0].count, 10),
      activeUsers: parseInt(usersRes.rows[0]?.active_users || 0, 10),
      inactiveUsers: parseInt(usersRes.rows[0]?.inactive_users || 0, 10),
      blockedDevices: parseInt(devicesRes.rows[0].count, 10),
      contractsExpiring30Days: parseInt(contractsRes.rows[0].count, 10)
    };
  }

  async getAttendanceToday(companyId) {
    const res = await query(
      `SELECT
         COUNT(*) as total_records,
         SUM(CASE WHEN late_minutes > 0 OR LOWER(status) = 'late' THEN 1 ELSE 0 END) as total_late,
         SUM(CASE WHEN check_in_is_mock_location = true THEN 1 ELSE 0 END) as fake_gps_alerts
       FROM attendance_records
       WHERE company_id = $1
         AND DATE(check_in_time) = CURRENT_DATE`,
      [companyId]
    );

    return {
      totalRecords: parseInt(res.rows[0].total_records, 10),
      totalLate: parseInt(res.rows[0].total_late || 0, 10),
      fakeGpsAlerts: parseInt(res.rows[0].fake_gps_alerts || 0, 10)
    };
  }

  async getWorkerHomeData(userId, companyId, workerId) {
    const today = new Date().toISOString().split('T')[0];
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    const [attendanceTodayRes, summaryMonthRes, requestsRes, vacations, notificationsRes, userMetaRes, shift, todayBirthdays, upcomingBirthdays] = await Promise.all([
      query(
        `SELECT ar.*, p.name as project_name
         FROM attendance_records ar
         LEFT JOIN projects p ON ar.project_id = p.id
         WHERE ar.worker_id = $1
           AND ar.date = $2::date
         ORDER BY ar.created_at DESC
         LIMIT 1`,
        [workerId, today]
      ),
      query(
        `SELECT
          COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) as worked_days,
          COALESCE(SUM(COALESCE(worked_hours, hours_worked, worked_minutes::numeric / 60.0, 0)), 0) as worked_hours,
          COALESCE(SUM(COALESCE(overtime_minutes, 0)), 0) as overtime_minutes,
          COUNT(*) FILTER (WHERE late_minutes > 0 OR LOWER(status) = 'late') as late_count,
          COUNT(*) FILTER (WHERE LOWER(status) = 'absent') as absence_count
         FROM attendance_records
         WHERE worker_id = $1
           AND date >= $2::date`,
        [workerId, startOfMonth]
      ),
      query(
        `SELECT
          COUNT(*) FILTER (WHERE LOWER(status) = 'pending') as pending,
          COUNT(*) FILTER (WHERE LOWER(status) = 'observed') as observed
         FROM employee_requests
         WHERE worker_id = $1`,
        [workerId]
      ),
      getVacationBalance(workerId),
      query(
        `SELECT COUNT(*) FROM notifications
         WHERE user_id = $1
           AND is_read = false`,
        [userId]
      ),
      query(
        `SELECT u.id,
                CONCAT_WS(' ', u.first_name, u.last_name) as name,
                CONCAT_WS(' ', u.first_name, u.last_name) as full_name,
                u.company_id,
                w.profile_photo_url,
                w.birth_date,
                p.id as project_id,
                p.name as project_name
         FROM users u
         LEFT JOIN workers w ON u.id = w.user_id
         LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
         LEFT JOIN projects p ON pa.project_id = p.id
         WHERE u.id = $1
         ORDER BY pa.assigned_at DESC
         LIMIT 1`,
        [userId]
      ),
      getWorkerShift(workerId, companyId),
      birthdayService.getTodayBirthdays(companyId),
      birthdayService.getUpcomingBirthdays(companyId)
    ]);

    const summaryMonth = summaryMonthRes.rows[0] || {};
    const requests = requestsRes.rows[0] || {};
    const userMeta = userMetaRes.rows[0] || {};

    return {
      user: {
        id: userMeta.id || null,
        name: userMeta.name || null,
        fullName: userMeta.full_name || null,
        role: 'worker',
        companyId: userMeta.company_id || null,
        projectId: userMeta.project_id || null,
        projectName: userMeta.project_name || null,
        profilePhotoUrl: userMeta.profile_photo_url || null,
        birthDate: formatDateOnly(userMeta.birth_date),
        isBirthday: isBirthdayToday(userMeta.birth_date),
        shift
      },
      attendanceToday: serializeAttendanceRecord(attendanceTodayRes.rows[0] || null, {
        todayDate: today,
        shift
      }),
      attendanceSummary: {
        workedDaysThisMonth: parseInt(summaryMonth.worked_days || 0, 10),
        workedHoursThisMonth: Number(summaryMonth.worked_hours || 0).toFixed(2),
        overtimeHoursThisMonth: (Number(summaryMonth.overtime_minutes || 0) / 60).toFixed(2),
        lateCount: parseInt(summaryMonth.late_count || 0, 10),
        absenceCount: parseInt(summaryMonth.absence_count || 0, 10)
      },
      requests: {
        pending: parseInt(requests.pending || 0, 10),
        observed: parseInt(requests.observed || 0, 10)
      },
      documents: {
        pending: 0,
        observed: 0
      },
      vacations: {
        availableDays: (Number(vacations?.accumulated_days || 0) - Number(vacations?.used_days || 0)),
        pendingRequests: Number(vacations?.pending_days || 0)
      },
      notifications: {
        unread: parseInt(notificationsRes.rows[0]?.count || 0, 10),
        latest: []
      },
      birthdays: {
        today: todayBirthdays.filter((item) => item.id !== userId),
        upcoming: upcomingBirthdays.filter((item) => item.id !== userId)
      }
    };
  }

  async getWorkerStatus(companyId) {
    const res = await query(
      `SELECT employment_status, COUNT(*)
       FROM workers
       WHERE company_id = $1
         AND deleted_at IS NULL
       GROUP BY employment_status`,
      [companyId]
    );

    return res.rows;
  }
}

module.exports = new DashboardRepository();
