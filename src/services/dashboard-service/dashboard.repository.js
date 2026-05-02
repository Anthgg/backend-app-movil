const { query } = require('../../config/database');

class DashboardRepository {
  async getSummaryMetrics(companyId) {
    // Total trabajadores activos
    const workersRes = await query(
      `SELECT COUNT(*) FROM workers WHERE company_id = $1 AND is_active = true AND deleted_at IS NULL`,
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
