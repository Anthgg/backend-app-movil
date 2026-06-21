const { query } = require('../../../config/database');
const moment = require('moment');

class VacationService {
  async getVacationBalance(workerId, tenantId) {
    const workerRes = await query(
      'SELECT hire_date FROM workers WHERE id = $1 AND company_id = $2',
      [workerId, tenantId]
    );
    if (workerRes.rows.length === 0 || !workerRes.rows[0].hire_date) {
      return { error: 'HIRE_DATE_REQUIRED' };
    }

    const hireDate = moment(workerRes.rows[0].hire_date);
    const today = moment();
    const completedYears = Math.max(today.diff(hireDate, 'years'), 0);
    const generatedDays = completedYears * 30;

    const requestsRes = await query(`
      SELECT CASE WHEN LOWER(r.status) = 'approved' THEN 'approved' ELSE 'pending' END AS status,
             SUM(COALESCE(r.days_requested, (r.end_date - r.start_date) + 1)) AS total_days
      FROM employee_requests r
      JOIN request_types rt ON rt.id = r.request_type_id
      WHERE r.worker_id = $1
        AND r.company_id = $2
        AND LOWER(r.status) IN ('approved', 'pending', 'pending_supervisor', 'pending_rrhh', 'observed')
        AND (
          UPPER(COALESCE(rt.code, '')) IN ('VACATION', 'VAC', 'VACACIONES')
          OR UPPER(rt.name) IN ('VACATION', 'VACACIONES')
        )
      GROUP BY CASE WHEN LOWER(r.status) = 'approved' THEN 'approved' ELSE 'pending' END
    `, [workerId, tenantId]);

    let usedDays = 0;
    let reservedDays = 0;
    for (const row of requestsRes.rows) {
      if (row.status === 'approved') usedDays = Number(row.total_days || 0);
      if (row.status === 'pending') reservedDays = Number(row.total_days || 0);
    }

    const availableDays = Number((generatedDays - usedDays - reservedDays).toFixed(2));

    return {
      workerId,
      hireDate: hireDate.format('YYYY-MM-DD'),
      yearsWorked: completedYears,
      annualVacationDays: 30,
      generatedDays,
      accumulatedDays: generatedDays,
      usedDays,
      reservedDays,
      pendingDays: reservedDays,
      availableDays,
      nextAccrualDate: hireDate.clone().add(completedYears + 1, 'years').format('YYYY-MM-DD'),
      calculationMode: 'completed_service_years_calendar_days',
      countryRule: 'PE_30_DAYS_PER_COMPLETED_YEAR'
    };
  }

  async checkVacationBalance(workerId, tenantId, daysRequested) {
    const balance = await this.getVacationBalance(workerId, tenantId);
    if (balance.error) {
      const error = new Error('El trabajador no tiene fecha de ingreso registrada');
      error.statusCode = 422;
      error.errorCode = 'HIRE_DATE_REQUIRED';
      throw error;
    }

    if (balance.availableDays < daysRequested) {
      const error = new Error(
        `Saldo de vacaciones insuficiente. Solicitados: ${daysRequested}, disponible: ${balance.availableDays}`
      );
      error.statusCode = 409;
      error.errorCode = 'INSUFFICIENT_VACATION_DAYS';
      error.data = { availableDays: balance.availableDays, requestedDays: daysRequested };
      throw error;
    }
  }
}

module.exports = new VacationService();
