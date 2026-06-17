const { query } = require('../../config/database');
const birthdayService = require('../birthday-service/service');
const moment = require('moment-timezone');
const { getWorkerShift, serializeAttendanceRecord, TIMEZONE } = require('../attendance-service/services/mobile-attendance.service');

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

function getPrimaryName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'colaborador';
}

function buildBirthdayGreeting(fullName, birthDate) {
  const show = isBirthdayToday(birthDate);
  return {
    show,
    message: show ? `Feliz cumpleanos, ${getPrimaryName(fullName)}!` : null
  };
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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

  async getPendingRequests(companyId, filters = {}) {
    const page = parsePositiveInt(filters.page, 1);
    const limit = parsePositiveInt(filters.limit, 10);
    const offset = (page - 1) * limit;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
           r.id,
           r.worker_id,
           r.request_type_id,
           r.start_date,
           r.end_date,
           r.reason,
           r.status,
           r.created_at,
           r.updated_at,
           CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
           rt.name AS request_type_name
         FROM employee_requests r
         JOIN workers w ON w.id = r.worker_id
         JOIN users u ON u.id = w.user_id
         LEFT JOIN request_types rt ON rt.id = r.request_type_id
         WHERE r.company_id = $1
           AND LOWER(r.status) = 'pending'
         ORDER BY r.created_at ASC
         LIMIT $2 OFFSET $3`,
        [companyId, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM employee_requests
         WHERE company_id = $1
           AND LOWER(status) = 'pending'`,
        [companyId]
      )
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0, 10);
    return {
      total,
      requests: dataRes.rows.map((row) => ({
        id: row.id,
        workerId: row.worker_id,
        workerName: row.worker_name,
        requestTypeId: row.request_type_id,
        requestTypeName: row.request_type_name,
        startDate: formatDateOnly(row.start_date),
        endDate: formatDateOnly(row.end_date),
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getContractsExpiring(companyId, filters = {}) {
    const page = parsePositiveInt(filters.page, 1);
    const limit = parsePositiveInt(filters.limit, 10);
    const daysAhead = parsePositiveInt(filters.daysAhead || filters.days_ahead, 30);
    const offset = (page - 1) * limit;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
           wc.id,
           wc.worker_id,
           wc.start_date,
           wc.end_date,
           wc.status,
           wc.agreed_salary,
           CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
           jp.name AS position_name,
           GREATEST((wc.end_date - CURRENT_DATE), 0) AS days_to_expire
         FROM worker_contracts wc
         JOIN workers w ON w.id = wc.worker_id
         JOIN users u ON u.id = w.user_id
         LEFT JOIN job_positions jp ON jp.id = w.job_position_id
         WHERE w.company_id = $1
           AND w.deleted_at IS NULL
           AND wc.end_date IS NOT NULL
           AND LOWER(wc.status) = 'active'
           AND wc.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($2::int * INTERVAL '1 day'))
         ORDER BY wc.end_date ASC, worker_name ASC
         LIMIT $3 OFFSET $4`,
        [companyId, daysAhead, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM worker_contracts wc
         JOIN workers w ON w.id = wc.worker_id
         WHERE w.company_id = $1
           AND w.deleted_at IS NULL
           AND wc.end_date IS NOT NULL
           AND LOWER(wc.status) = 'active'
           AND wc.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($2::int * INTERVAL '1 day'))`,
        [companyId, daysAhead]
      )
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0, 10);
    return {
      total,
      contracts: dataRes.rows.map((row) => ({
        id: row.id,
        workerId: row.worker_id,
        workerName: row.worker_name,
        positionName: row.position_name,
        startDate: formatDateOnly(row.start_date),
        endDate: formatDateOnly(row.end_date),
        status: row.status,
        agreedSalary: Number(row.agreed_salary || 0),
        daysToExpire: Number(row.days_to_expire || 0)
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getDocumentsPending(companyId, filters = {}) {
    const page = parsePositiveInt(filters.page, 1);
    const limit = parsePositiveInt(filters.limit, 10);
    const offset = (page - 1) * limit;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
           d.id,
           d.worker_id,
           d.document_type_id,
           d.file_url,
           d.status,
           d.hr_comment,
           d.uploaded_at,
           d.updated_at,
           dt.name AS document_type_name,
           CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name
         FROM documents d
         JOIN workers w ON w.id = d.worker_id
         JOIN users u ON u.id = w.user_id
         LEFT JOIN document_types dt ON dt.id = d.document_type_id
         WHERE w.company_id = $1
           AND w.deleted_at IS NULL
           AND d.deleted_at IS NULL
           AND LOWER(d.status) = 'pending'
         ORDER BY COALESCE(d.updated_at, d.uploaded_at) DESC
         LIMIT $2 OFFSET $3`,
        [companyId, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM documents d
         JOIN workers w ON w.id = d.worker_id
         WHERE w.company_id = $1
           AND w.deleted_at IS NULL
           AND d.deleted_at IS NULL
           AND LOWER(d.status) = 'pending'`,
        [companyId]
      )
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0, 10);
    return {
      total,
      documents: dataRes.rows.map((row) => ({
        id: row.id,
        workerId: row.worker_id,
        workerName: row.worker_name,
        documentTypeId: row.document_type_id,
        documentTypeName: row.document_type_name,
        fileUrl: row.file_url,
        status: row.status,
        comment: row.hr_comment,
        uploadedAt: row.uploaded_at,
        updatedAt: row.updated_at
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getLateWorkers(companyId, filters = {}) {
    const page = parsePositiveInt(filters.page, 1);
    const limit = parsePositiveInt(filters.limit, 10);
    const offset = (page - 1) * limit;

    const [dataRes, countRes] = await Promise.all([
      query(
        `SELECT
           ar.id,
           ar.worker_id,
           ar.project_id,
           ar.status,
           ar.check_in_time,
           ar.late_minutes,
           CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
           p.name AS project_name
         FROM attendance_records ar
         JOIN workers w ON w.id = ar.worker_id
         JOIN users u ON u.id = w.user_id
         LEFT JOIN projects p ON p.id = ar.project_id
         WHERE ar.company_id = $1
           AND ar.date = CURRENT_DATE
           AND (COALESCE(ar.late_minutes, 0) > 0 OR LOWER(ar.status) = 'late')
         ORDER BY COALESCE(ar.late_minutes, 0) DESC, ar.check_in_time DESC
         LIMIT $2 OFFSET $3`,
        [companyId, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM attendance_records
         WHERE company_id = $1
           AND date = CURRENT_DATE
           AND (COALESCE(late_minutes, 0) > 0 OR LOWER(status) = 'late')`,
        [companyId]
      )
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0, 10);
    return {
      date: formatDateOnly(new Date()),
      total,
      workers: dataRes.rows.map((row) => ({
        attendanceId: row.id,
        workerId: row.worker_id,
        workerName: row.worker_name,
        projectId: row.project_id,
        projectName: row.project_name,
        status: row.status,
        checkIn: row.check_in_time,
        lateMinutes: Number(row.late_minutes || 0)
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getProjectSummary(companyId) {
    const result = await query(
      `WITH assigned_workers AS (
         SELECT
           p.id AS project_id,
           p.name AS project_name,
           COUNT(DISTINCT pa.worker_id) FILTER (WHERE pa.unassigned_at IS NULL) AS assigned_workers
         FROM projects p
         LEFT JOIN project_assignments pa ON pa.project_id = p.id
         WHERE p.company_id = $1
           AND p.deleted_at IS NULL
           AND COALESCE(p.is_active, true) = true
         GROUP BY p.id, p.name
       ),
       today_attendance AS (
         SELECT
           project_id,
           COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) AS attendance_today,
           COUNT(*) FILTER (WHERE COALESCE(late_minutes, 0) > 0 OR LOWER(status) = 'late') AS late_today,
           COUNT(*) FILTER (WHERE LOWER(status) = 'absent') AS absent_today
         FROM attendance_records
         WHERE company_id = $1
           AND date = CURRENT_DATE
         GROUP BY project_id
       )
       SELECT
         aw.project_id,
         aw.project_name,
         COALESCE(aw.assigned_workers, 0) AS assigned_workers,
         COALESCE(ta.attendance_today, 0) AS attendance_today,
         COALESCE(ta.late_today, 0) AS late_today,
         COALESCE(ta.absent_today, 0) AS absent_today
       FROM assigned_workers aw
       LEFT JOIN today_attendance ta ON ta.project_id = aw.project_id
       ORDER BY aw.project_name ASC`,
      [companyId]
    );

    const projects = result.rows.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      assignedWorkers: Number(row.assigned_workers || 0),
      attendanceToday: Number(row.attendance_today || 0),
      lateToday: Number(row.late_today || 0),
      absentToday: Number(row.absent_today || 0)
    }));

    return {
      projects,
      totals: {
        projects: projects.length,
        assignedWorkers: projects.reduce((sum, row) => sum + row.assignedWorkers, 0),
        attendanceToday: projects.reduce((sum, row) => sum + row.attendanceToday, 0),
        lateToday: projects.reduce((sum, row) => sum + row.lateToday, 0),
        absentToday: projects.reduce((sum, row) => sum + row.absentToday, 0)
      }
    };
  }

  async getBirthdays(companyId, filters = {}) {
    const days = parsePositiveInt(filters.days || filters.daysAhead || filters.days_ahead, 30);
    const [today, upcoming] = await Promise.all([
      birthdayService.getTodayBirthdays(companyId),
      birthdayService.getUpcomingBirthdays(companyId, days)
    ]);

    return {
      today,
      upcoming,
      counts: {
        today: today.length,
        upcoming: upcoming.length
      }
    };
  }

  async getAlerts(companyId, filters = {}) {
    const [summary, attendanceToday, pendingRequests, contractsExpiring, documentsPending, lateWorkers, birthdays] = await Promise.all([
      this.getSummaryMetrics(companyId),
      this.getAttendanceToday(companyId),
      this.getPendingRequests(companyId, { limit: 5 }),
      this.getContractsExpiring(companyId, { limit: 5, daysAhead: filters.daysAhead || filters.days_ahead || 30 }),
      this.getDocumentsPending(companyId, { limit: 5 }),
      this.getLateWorkers(companyId, { limit: 5 }),
      this.getBirthdays(companyId, filters)
    ]);

    const alerts = [];

    if (pendingRequests.total > 0) {
      alerts.push({
        type: 'pending_requests',
        severity: 'warning',
        total: pendingRequests.total,
        message: `${pendingRequests.total} solicitud(es) pendientes de revision.`
      });
    }

    if (contractsExpiring.total > 0) {
      alerts.push({
        type: 'contracts_expiring',
        severity: 'warning',
        total: contractsExpiring.total,
        message: `${contractsExpiring.total} contrato(s) vencen pronto.`
      });
    }

    if (documentsPending.total > 0) {
      alerts.push({
        type: 'documents_pending',
        severity: 'info',
        total: documentsPending.total,
        message: `${documentsPending.total} documento(s) pendientes de revision.`
      });
    }

    if (lateWorkers.total > 0) {
      alerts.push({
        type: 'late_workers',
        severity: 'warning',
        total: lateWorkers.total,
        message: `${lateWorkers.total} trabajador(es) llegaron tarde hoy.`
      });
    }

    if (birthdays.counts.today > 0) {
      alerts.push({
        type: 'birthdays_today',
        severity: 'info',
        total: birthdays.counts.today,
        message: `${birthdays.counts.today} cumpleanero(s) hoy.`
      });
    }

    if (attendanceToday.fakeGpsAlerts > 0) {
      alerts.push({
        type: 'fake_gps_alerts',
        severity: 'critical',
        total: attendanceToday.fakeGpsAlerts,
        message: `${attendanceToday.fakeGpsAlerts} alerta(s) de GPS sospechoso hoy.`
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        activeWorkers: summary.activeWorkers,
        pendingRequests: pendingRequests.total,
        contractsExpiring: contractsExpiring.total,
        documentsPending: documentsPending.total,
        lateWorkersToday: lateWorkers.total,
        birthdaysToday: birthdays.counts.today,
        birthdaysUpcoming: birthdays.counts.upcoming,
        fakeGpsAlertsToday: attendanceToday.fakeGpsAlerts
      },
      alerts
    };
  }

  async getWorkerHomeData(userId, companyId, workerId) {
    const now = moment().tz(TIMEZONE);
    const today = now.format('YYYY-MM-DD');
    const startOfMonth = now.clone().startOf('month').format('YYYY-MM-DD');

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
      birthdayGreeting: buildBirthdayGreeting(userMeta.full_name || userMeta.name, userMeta.birth_date),
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

  async getWeeklyAttendanceChart(companyId) {
    const res = await query(
      `WITH last_7_days AS (
         SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day')::date AS date
       )
       SELECT
         to_char(d.date, 'Day') AS day_name,
         d.date,
         COUNT(a.id) AS total_present,
         SUM(CASE WHEN COALESCE(a.late_minutes, 0) > 0 OR LOWER(a.status) = 'late' THEN 1 ELSE 0 END) AS total_late,
         COALESCE(SUM(COALESCE(a.worked_hours, a.hours_worked, a.worked_minutes::numeric / 60.0, 0)), 0) AS total_hours
       FROM last_7_days d
       LEFT JOIN attendance_records a ON a.date = d.date AND a.company_id = $1
       GROUP BY d.date
       ORDER BY d.date ASC`,
      [companyId]
    );

    return res.rows.map(row => ({
      dayName: row.day_name.trim(),
      date: formatDateOnly(row.date),
      totalPresent: parseInt(row.total_present, 10),
      totalLate: parseInt(row.total_late, 10),
      totalHours: Number(Number(row.total_hours).toFixed(2))
    }));
  }

  async getDailyStatusList(companyId, filters = {}) {
    const page = parsePositiveInt(filters.page, 1);
    const limit = parsePositiveInt(filters.limit, 10);
    const offset = (page - 1) * limit;

    const [dataRes, countRes] = await Promise.all([
      query(
         `SELECT
            a.id,
            a.worker_id,
            a.check_in_time,
            a.check_out_time,
            a.status,
            a.late_minutes,
            a.overtime_minutes,
            a.max_overtime_minutes,
            a.overtime_active,
            CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
            u.profile_photo_url,
            p.name AS project_name
          FROM attendance_records a
          JOIN workers w ON a.worker_id = w.id
          JOIN users u ON w.user_id = u.id
          LEFT JOIN projects p ON a.project_id = p.id
          WHERE a.company_id = $1 AND a.date = CURRENT_DATE
          ORDER BY a.check_in_time DESC
          LIMIT $2 OFFSET $3`,
        [companyId, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM attendance_records
         WHERE company_id = $1 AND date = CURRENT_DATE`,
        [companyId]
      )
    ]);

    const total = parseInt(countRes.rows[0]?.total || 0, 10);
    return {
      total,
      workers: dataRes.rows.map(row => ({
        attendanceId: row.id,
        attendance_id: row.id,
        workerId: row.worker_id,
        worker_id: row.worker_id,
        workerName: row.worker_name,
        worker_name: row.worker_name,
        avatar_url: row.profile_photo_url,
        profile_photo_url: row.profile_photo_url,
        projectName: row.project_name,
        project_name: row.project_name,
        checkIn: row.check_in_time,
        check_in: row.check_in_time,
        checkOut: row.check_out_time,
        check_out: row.check_out_time,
        status: row.status,
        lateMinutes: row.late_minutes,
        late_minutes: row.late_minutes,
        overtimeMinutes: row.overtime_minutes || (row.overtime_active ? row.max_overtime_minutes : 0),
        overtime_minutes: row.overtime_minutes || (row.overtime_active ? row.max_overtime_minutes : 0),
        approved_overtime_minutes: row.overtime_active ? row.max_overtime_minutes : 0
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}

module.exports = new DashboardRepository();
