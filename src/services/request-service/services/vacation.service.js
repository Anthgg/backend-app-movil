const { query } = require('../../../config/database');
const moment = require('moment');

const VACATION_DAYS_PER_YEAR = 30;
const VACATION_DAYS_PER_MONTH = VACATION_DAYS_PER_YEAR / 12;
const VACATION_DAYS_PER_SERVICE_DAY = VACATION_DAYS_PER_MONTH / 30;

class VacationService {
  calculateAccruedVacation(hireDateValue, asOfDateValue = moment()) {
    const hireDate = moment(hireDateValue).startOf('day');
    const asOfDate = moment(asOfDateValue).startOf('day');

    if (!hireDate.isValid() || !asOfDate.isValid() || asOfDate.isBefore(hireDate, 'day')) {
      return {
        generatedDays: 0,
        completedServiceMonths: 0,
        remainingServiceDays: 0,
        dailyAccrualRate: Number(VACATION_DAYS_PER_SERVICE_DAY.toFixed(6))
      };
    }

    const completedServiceMonths = asOfDate.diff(hireDate, 'months');
    const completedMonthsDate = hireDate.clone().add(completedServiceMonths, 'months');
    const remainingServiceDays = asOfDate.diff(completedMonthsDate, 'days');
    const generatedDays = Number((
      completedServiceMonths * VACATION_DAYS_PER_MONTH
      + remainingServiceDays * VACATION_DAYS_PER_SERVICE_DAY
    ).toFixed(2));

    return {
      generatedDays,
      completedServiceMonths,
      remainingServiceDays,
      dailyAccrualRate: Number(VACATION_DAYS_PER_SERVICE_DAY.toFixed(6))
    };
  }

  buildRequestAssessment(balance, daysRequested) {
    if (balance.error) {
      const error = new Error('El trabajador no tiene fecha de ingreso registrada');
      error.statusCode = 422;
      error.errorCode = 'HIRE_DATE_REQUIRED';
      throw error;
    }

    const requestedDays = Number(daysRequested || 0);
    const availableDays = Number(balance.availableDays || 0);
    const projectedAvailableDays = Number((availableDays - requestedDays).toFixed(2));

    return {
      availableDaysAtRequest: availableDays,
      requestedDays,
      projectedAvailableDays,
      exceedsAvailableBalance: requestedDays > availableDays,
      requiresManagerOverride: requestedDays > availableDays
    };
  }

  async getVacationBalance(workerId, tenantId) {
    const workerRes = await query(
      'SELECT hire_date FROM workers WHERE id = $1 AND company_id = $2',
      [workerId, tenantId]
    );
    if (workerRes.rows.length === 0 || !workerRes.rows[0].hire_date) {
      return { error: 'HIRE_DATE_REQUIRED' };
    }

    const hireDate = moment(workerRes.rows[0].hire_date);
    const today = moment().startOf('day');
    const accrual = this.calculateAccruedVacation(hireDate, today);
    const completedYears = Math.floor(accrual.completedServiceMonths / 12);
    const generatedDays = accrual.generatedDays;

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
      completedServiceMonths: accrual.completedServiceMonths,
      remainingServiceDays: accrual.remainingServiceDays,
      annualVacationDays: VACATION_DAYS_PER_YEAR,
      monthlyAccrualRate: VACATION_DAYS_PER_MONTH,
      dailyAccrualRate: accrual.dailyAccrualRate,
      generatedDays,
      accumulatedDays: generatedDays,
      usedDays,
      reservedDays,
      pendingDays: reservedDays,
      availableDays,
      nextAccrualDate: today.clone().add(1, 'day').format('YYYY-MM-DD'),
      nextServiceAnniversary: hireDate.clone().add(completedYears + 1, 'years').format('YYYY-MM-DD'),
      calculationMode: 'service_months_and_days_prorated',
      countryRule: 'PE_30_DAYS_PER_YEAR_PRORATED'
    };
  }

  async checkVacationBalance(workerId, tenantId, daysRequested) {
    const balance = await this.getVacationBalance(workerId, tenantId);
    const assessment = this.buildRequestAssessment(balance, daysRequested);

    if (assessment.exceedsAvailableBalance) {
      const error = new Error(
        `Saldo de vacaciones insuficiente. Solicitados: ${daysRequested}, disponible: ${balance.availableDays}`
      );
      error.statusCode = 409;
      error.errorCode = 'INSUFFICIENT_VACATION_DAYS';
      error.data = { availableDays: balance.availableDays, requestedDays: daysRequested };
      throw error;
    }

    return assessment;
  }

  async assessVacationRequest(workerId, tenantId, daysRequested) {
    const balance = await this.getVacationBalance(workerId, tenantId);
    return this.buildRequestAssessment(balance, daysRequested);
  }
}

module.exports = new VacationService();
