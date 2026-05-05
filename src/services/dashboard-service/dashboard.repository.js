const { query } = require('../../config/database');

class DashboardRepository {
  async getSummaryMetrics(companyId) {
    // Total trabajadores activos (con fecha de ingreso cumplida)
    const workersRes = await query(
      `SELECT COUNT(*) FROM workers 
       WHERE company_id = $1 
       AND is_active = true 
       AND hire_date <= CURRENT_DATE
       AND deleted_at IS NULL`,
      [companyId]
    );

    // Total usuarios (activos vs inactivos)
    const usersRes = await query(
      `SELECT 
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) as inactive_users
       FROM users WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );

    // Dispositivos bloqueados
    const devicesRes = await query(
      `SELECT COUNT(*) FROM user_devices ud JOIN users u ON ud.user_id = u.id 
       WHERE u.company_id = $1 AND ud.is_blocked = true`,
      [companyId]
    );

    // Contratos por vencer (ejemplo: próximos 30 días)
    const contractsRes = await query(
      `SELECT COUNT(*) FROM worker_contracts wc JOIN workers w ON wc.worker_id = w.id
       WHERE w.company_id = $1 AND wc.status = 'ACTIVE' AND wc.end_date <= (NOW() + INTERVAL '30 days')`,
      [companyId]
    );

    return {
      activeWorkers: parseInt(workersRes.rows[0].count),
      activeUsers: parseInt(usersRes.rows[0]?.active_users || 0),
      inactiveUsers: parseInt(usersRes.rows[0]?.inactive_users || 0),
      blockedDevices: parseInt(devicesRes.rows[0].count),
      contractsExpiring30Days: parseInt(contractsRes.rows[0].count)
    };
  }

  async getAttendanceToday(companyId) {
    const res = await query(
      `SELECT 
         COUNT(*) as total_records,
         SUM(CASE WHEN status = 'LATE' THEN 1 ELSE 0 END) as total_late,
         SUM(CASE WHEN is_mock_location = true THEN 1 ELSE 0 END) as fake_gps_alerts
       FROM attendance_records 
       WHERE company_id = $1 AND DATE(check_in_time) = CURRENT_DATE`,
      [companyId]
    );
    return {
      totalRecords: parseInt(res.rows[0].total_records),
      totalLate: parseInt(res.rows[0].total_late),
      fakeGpsAlerts: parseInt(res.rows[0].fake_gps_alerts)
    };
  }

  async getWorkerHomeData(userId, companyId, workerId) {
    const today = new Date().toISOString().split('T')[0]; // Simple YYYY-MM-DD
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    // 1. Asistencia Hoy
    const attendanceToday = await query(
      `SELECT ar.*, p.name as project_name 
       FROM attendance_records ar
       LEFT JOIN projects p ON ar.project_id = p.id
       WHERE ar.worker_id = $1 AND ar.date = $2::date LIMIT 1`,
      [workerId, today]
    );

    // 2. Resumen Mensual
    const summaryMonth = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) as worked_days,
        COALESCE(SUM(worked_hours), 0) as worked_hours,
        COUNT(*) FILTER (WHERE status = 'LATE') as late_count
       FROM attendance_records 
       WHERE worker_id = $1 AND date >= $2::date`,
      [workerId, startOfMonth]
    );

    // 3. Solicitudes y Documentos
    const requests = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'OBSERVED') as observed
       FROM employee_requests WHERE worker_id = $1`,
      [workerId]
    );

    // 4. Vacaciones
    const vacations = await query(
      `SELECT accumulated_days, used_days, pending_days FROM worker_vacation_balances WHERE worker_id = $1`,
      [workerId]
    );

    // 5. Notificaciones No Leídas
    const notifications = await query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    // 6. Metadata Usuario y Proyecto
    const userMeta = await query(
      `SELECT u.id, CONCAT_WS(' ', u.first_name, u.last_name) as name, u.company_id,
              p.id as project_id, p.name as project_name
       FROM users u
       LEFT JOIN workers w ON u.id = w.user_id
       LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
       LEFT JOIN projects p ON pa.project_id = p.id
       WHERE u.id = $1 ORDER BY pa.assigned_at DESC LIMIT 1`,
      [userId]
    );

    return {
      user: {
        id: userMeta.rows[0]?.id,
        name: userMeta.rows[0]?.name,
        role: 'worker', // Simplificado
        companyId: userMeta.rows[0]?.company_id,
        projectId: userMeta.rows[0]?.project_id,
        projectName: userMeta.rows[0]?.project_name
      },
      attendanceToday: attendanceToday.rows[0] ? {
        status: attendanceToday.rows[0].check_out_time ? 'checked_out' : 'checked_in',
        checkIn: attendanceToday.rows[0].check_in_time,
        checkOut: attendanceToday.rows[0].check_out_time,
        workedHours: attendanceToday.rows[0].worked_hours,
        date: today
      } : { status: 'none', checkIn: null, checkOut: null, workedHours: 0, date: today },
      attendanceSummary: {
        workedDaysThisMonth: parseInt(summaryMonth.rows[0].worked_days),
        workedHoursThisMonth: parseFloat(summaryMonth.rows[0].worked_hours).toFixed(2),
        lateCount: parseInt(summaryMonth.rows[0].late_count),
        absenceCount: 0 // TODO: Lógica de faltas
      },
      requests: {
        pending: parseInt(requests.rows[0]?.pending || 0),
        observed: parseInt(requests.rows[0]?.observed || 0)
      },
      documents: {
        pending: 0, // TODO: Tabla de documentos
        observed: 0
      },
      vacations: {
        availableDays: (vacations.rows[0]?.accumulated_days || 0) - (vacations.rows[0]?.used_days || 0),
        pendingRequests: vacations.rows[0]?.pending_days || 0
      },
      notifications: {
        unread: parseInt(notifications.rows[0]?.count || 0),
        latest: []
      }
    };
  }

  async getWorkerStatus(companyId) {
    const res = await query(
      `SELECT employment_status, COUNT(*) 
       FROM workers 
       WHERE company_id = $1 AND deleted_at IS NULL 
       GROUP BY employment_status`,
      [companyId]
    );
    return res.rows;
  }
}

module.exports = new DashboardRepository();
