const { query } = require('../../../config/database');
const ExcelJS = require('exceljs');
const moment = require('moment');
const scheduleService = require('../../schedule-service/services/laborSchedule.service');
const { getApprovedAttendanceDayCounts } = require('../../../shared/services/attendance-day-status.service');

class PayrollService {
  async createPeriod(tenantId, data, user) {
    const overlap = await query(
      `SELECT id
       FROM payroll_periods
       WHERE company_id = $1
         AND year = $2
         AND month = $3`,
      [tenantId, data.year, data.month]
    );
    if (overlap.rows.length > 0) throw new Error('Ya existe un periodo para ese ano y mes.');

    const res = await query(`
      INSERT INTO payroll_periods (company_id, name, year, month, start_date, end_date, generated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [tenantId, data.name, data.year, data.month, data.start_date, data.end_date, user.id]);

    return res.rows[0];
  }

  async getPeriods(tenantId) {
    const res = await query(
      `SELECT *
       FROM payroll_periods
       WHERE company_id = $1
       ORDER BY year DESC, month DESC`,
      [tenantId]
    );
    return res.rows;
  }

  async getPayrollWorkers(tenantId, period) {
    const res = await query(`
      SELECT w.id,
             w.hire_date,
             active_contract.end_date AS contract_end_date,
             COALESCE(active_contract.agreed_salary, jp.base_salary, 1500)::numeric AS base_salary
      FROM workers w
      JOIN users u ON u.id = w.user_id
      LEFT JOIN job_positions jp ON jp.id = w.job_position_id
      LEFT JOIN LATERAL (
        SELECT wc.agreed_salary, wc.end_date
        FROM worker_contracts wc
        WHERE wc.worker_id = w.id
          AND LOWER(COALESCE(wc.status, 'active')) = 'active'
          AND (wc.start_date IS NULL OR wc.start_date <= $3::date)
          AND (wc.end_date IS NULL OR wc.end_date >= $2::date)
        ORDER BY wc.start_date DESC NULLS LAST
        LIMIT 1
      ) active_contract ON true
      WHERE w.company_id = $1
        AND w.deleted_at IS NULL
        AND COALESCE(w.is_active, true) = true
        AND COALESCE(u.is_active, true) = true
        AND (w.hire_date IS NULL OR w.hire_date <= $3::date)
    `, [tenantId, period.start_date, period.end_date]);

    return res.rows;
  }

  async calculateExpectedMinutes(tenantId, worker, startDate, endDate) {
    const policy = await scheduleService.getPolicy(tenantId);
    const start = moment.max(moment(startDate), worker.hire_date ? moment(worker.hire_date) : moment(startDate));
    const end = worker.contract_end_date
      ? moment.min(moment(endDate), moment(worker.contract_end_date))
      : moment(endDate);

    if (end.isBefore(start, 'day')) {
      return 0;
    }

    let expectedMinutes = 0;
    const cursor = start.clone();
    while (cursor.isSameOrBefore(end, 'day')) {
      const schedule = await scheduleService.resolveWorkerSchedule(worker.id, tenantId, cursor.format('YYYY-MM-DD'));
      if (schedule.shift && schedule.isWorkingDay) {
        expectedMinutes += schedule.expectedMinutes || policy.defaultEffectiveMinutes || 0;
      }
      cursor.add(1, 'day');
    }

    return expectedMinutes;
  }

  async generatePayroll(tenantId, periodId, user) {
    const periodRes = await query(
      `SELECT *
       FROM payroll_periods
       WHERE id = $1
         AND company_id = $2`,
      [periodId, tenantId]
    );
    if (periodRes.rows.length === 0) throw new Error('Periodo no encontrado.');
    const period = periodRes.rows[0];

    if (['closed', 'approved'].includes(period.status)) {
      throw new Error('No se puede generar o recalcular un periodo cerrado o aprobado.');
    }

    const payrollSettingsRes = await query(`
      SELECT *
      FROM payroll_settings
      WHERE company_id = $1
        AND COALESCE(is_active, true) = true
      LIMIT 1
    `, [tenantId]);
    const payrollSettings = payrollSettingsRes.rows[0] || {};
    const overtimeMultiplier = Number(payrollSettings.overtime_multiplier || 1.25);
    const discountLateEnabled = payrollSettings.discount_late_enabled !== false;
    const discountAbsenceEnabled = payrollSettings.discount_absence_enabled !== false;
    const overtimeEnabled = payrollSettings.overtime_enabled !== false;

    await query(`DELETE FROM payroll_records WHERE payroll_period_id = $1`, [periodId]);

    const workers = await this.getPayrollWorkers(tenantId, period);
    const periodStart = moment(period.start_date);
    const periodEnd = moment(period.end_date);
    const totalPeriodDays = periodEnd.diff(periodStart, 'days') + 1;
    const processedRecords = [];

    for (const worker of workers) {
      const baseSalary = Number(worker.base_salary || 1500);
      const dailyRate = baseSalary / 30;
      const computableStart = moment.max(periodStart, worker.hire_date ? moment(worker.hire_date) : periodStart);
      const computableEnd = worker.contract_end_date ? moment.min(periodEnd, moment(worker.contract_end_date)) : periodEnd;
      const computableDays = Math.max(computableEnd.diff(computableStart, 'days') + 1, 0);
      const proportionalSalary = computableDays < totalPeriodDays ? dailyRate * computableDays : baseSalary;
      const expectedMinutes = await this.calculateExpectedMinutes(tenantId, worker, period.start_date, period.end_date);

      const attendanceRes = await query(`
        SELECT
          COUNT(*) FILTER (WHERE ar.check_in_time IS NOT NULL)::int AS worked_days,
          COUNT(*) FILTER (WHERE ar.status = 'absent' AND approved_leave.id IS NULL)::int AS absent_days,
          COALESCE(SUM(CASE WHEN ar.status = 'absent' AND approved_leave.id IS NULL THEN COALESCE(ar.expected_minutes, 0) ELSE 0 END), 0)::int AS absent_minutes,
          COALESCE(SUM(COALESCE(ar.late_minutes, 0)), 0)::int AS late_minutes,
          COALESCE(SUM(COALESCE(ar.worked_minutes, 0)), 0)::int AS worked_minutes,
          COALESCE(SUM(COALESCE(ar.effective_worked_minutes, ar.worked_minutes, 0)), 0)::int AS effective_worked_minutes,
          COALESCE(SUM(COALESCE(ar.overtime_minutes, 0)), 0)::int AS overtime_minutes,
          COUNT(*) FILTER (WHERE h.id IS NOT NULL AND ar.check_in_time IS NOT NULL)::int AS holidays_worked_days
        FROM attendance_records ar
        LEFT JOIN holidays h ON h.date = ar.date AND h.country = 'PE' AND h.is_active = true
        LEFT JOIN LATERAL (
          SELECT er.id
          FROM employee_requests er
          JOIN request_types rt ON rt.id = er.request_type_id
          WHERE er.worker_id = ar.worker_id
            AND er.company_id = ar.company_id
            AND LOWER(er.status) = 'approved'
            AND ar.date BETWEEN er.start_date AND er.end_date
            AND UPPER(COALESCE(rt.code, rt.name)) IN (
              'VACATION', 'VAC', 'VACACIONES',
              'MEDICAL_LEAVE', 'MEDICAL', 'DESCANSO_MEDICO',
              'UNPAID_LEAVE', 'PERSONAL_PERMISSION', 'PERMISO_PERSONAL', 'LEAVE_PERMISSION'
            )
          LIMIT 1
        ) approved_leave ON TRUE
        WHERE ar.company_id = $1
          AND ar.worker_id = $2
          AND ar.date >= $3::date
          AND ar.date <= $4::date
      `, [tenantId, worker.id, period.start_date, period.end_date]);

      const attendance = attendanceRes.rows[0] || {};
      const approvedDayCounts = await getApprovedAttendanceDayCounts(
        worker.id,
        tenantId,
        period.start_date,
        period.end_date
      );
      const expectedHours = expectedMinutes / 60;
      const hourlyRate = expectedHours > 0 ? proportionalSalary / expectedHours : 0;
      const baseAbsenceDiscount = discountAbsenceEnabled ? (Number(attendance.absent_minutes || 0) / 60) * hourlyRate : 0;
      
      // Peruvian dominical extra discount logic:
      // 1 absent day = 0.5 day extra penalty
      // 2 or more absent days = 1 full day extra penalty
      let extraDominicalDiscount = 0;
      const absentDays = Number(attendance.absent_days || 0);
      if (discountAbsenceEnabled) {
        if (absentDays === 1) {
          extraDominicalDiscount = dailyRate * 0.5;
        } else if (absentDays >= 2) {
          extraDominicalDiscount = dailyRate * 1.0;
        }
      }
      
      const absenceDiscount = baseAbsenceDiscount + extraDominicalDiscount;
      const vacationDays = Number(approvedDayCounts.VACATION || 0);
      const medicalLeaveDays = Number(approvedDayCounts.MEDICAL_LEAVE || 0);
      const unpaidLeaveDays = Number(approvedDayCounts.UNPAID_LEAVE || 0);
      const vacationPay = dailyRate * vacationDays;
      const medicalLeavePay = dailyRate * medicalLeaveDays;
      const unpaidPermissionDiscount = dailyRate * unpaidLeaveDays;

      const lateDiscount = discountLateEnabled ? (Number(attendance.late_minutes || 0) / 60) * hourlyRate : 0;
      const overtimeAmount = overtimeEnabled ? (Number(attendance.overtime_minutes || 0) / 60) * hourlyRate * overtimeMultiplier : 0;
      
      const holidaysWorkedDays = Number(attendance.holidays_worked_days || 0);
      const holidayMultiplier = 2; // Extra payment for working on a holiday (typically pays double the day)
      const holidayAmount = holidaysWorkedDays * dailyRate * holidayMultiplier;

      const grossAmount = proportionalSalary;
      const netEstimatedAmount = Math.max(
        grossAmount - absenceDiscount - lateDiscount - unpaidPermissionDiscount + overtimeAmount + holidayAmount,
        0
      );

      const rec = await query(`
        INSERT INTO payroll_records (
          company_id,
          payroll_period_id,
          worker_id,
          base_salary,
          daily_rate,
          hourly_rate,
          worked_days,
          absent_days,
          vacation_days,
          medical_leave_days,
          permission_unpaid_days,
          late_minutes,
          worked_minutes,
          overtime_minutes,
          gross_amount,
          absence_discount,
          late_discount,
          unpaid_permission_discount,
          overtime_amount,
          net_estimated_amount,
          status,
          calculation_details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'calculated', $21)
        RETURNING *
      `, [
        tenantId,
        periodId,
        worker.id,
        baseSalary,
        dailyRate,
        hourlyRate,
        Number(attendance.worked_days || 0),
        Number(attendance.absent_days || 0),
        vacationDays,
        medicalLeaveDays,
        unpaidLeaveDays,
        Number(attendance.late_minutes || 0),
        Number(attendance.effective_worked_minutes || attendance.worked_minutes || 0),
        Number(attendance.overtime_minutes || 0),
        grossAmount,
        absenceDiscount,
        lateDiscount,
        unpaidPermissionDiscount,
        overtimeAmount + holidayAmount,
        netEstimatedAmount,
        {
          expected_minutes: expectedMinutes,
          expected_hours: Number(expectedHours.toFixed(2)),
          computable_days: computableDays,
          period_days: totalPeriodDays,
          proportional_salary: Number(proportionalSalary.toFixed(2)),
          salary_source: 'active_contract_or_job_position',
          overtime_multiplier: overtimeMultiplier,
          holiday_worked_days: holidaysWorkedDays,
          holiday_amount: holidayAmount,
          absent_days: absentDays,
          vacation_days: vacationDays,
          medical_leave_days: medicalLeaveDays,
          unpaid_leave_days: unpaidLeaveDays,
          vacation_pay_included_in_gross: Number(vacationPay.toFixed(2)),
          medical_leave_pay_included_in_gross: Number(medicalLeavePay.toFixed(2)),
          unpaid_leave_deduction: Number(unpaidPermissionDiscount.toFixed(2))
        }
      ]);

      processedRecords.push(rec.rows[0]);
    }

    await query(`UPDATE payroll_periods SET status = 'generated', updated_at = NOW() WHERE id = $1`, [periodId]);
    return processedRecords;
  }

  async recalculatePayroll(tenantId, periodId, user) {
    return this.generatePayroll(tenantId, periodId, user);
  }

  async updatePeriodStatus(tenantId, periodId, newStatus, user) {
    const res = await query(`
      UPDATE payroll_periods
      SET status = $1,
          updated_at = NOW(),
          approved_by = CASE WHEN $1 = 'approved' THEN $2::uuid ELSE approved_by END,
          approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
          closed_by = CASE WHEN $1 = 'closed' THEN $2::uuid ELSE closed_by END,
          closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE closed_at END
      WHERE id = $3
        AND company_id = $4
      RETURNING *
    `, [newStatus, user.id, periodId, tenantId]);

    if (res.rows.length === 0) throw new Error('Periodo no encontrado.');
    return res.rows[0];
  }

  async exportExcel(tenantId, periodId) {
    const recordsRes = await query(`
      SELECT p.*, u.email
      FROM payroll_records p
      JOIN workers w ON p.worker_id = w.id
      JOIN users u ON w.user_id = u.id
      WHERE p.payroll_period_id = $1
        AND p.company_id = $2
    `, [periodId, tenantId]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Planilla Estimada');

    worksheet.columns = [
      { header: 'Trabajador Email', key: 'email', width: 25 },
      { header: 'Sueldo Base', key: 'base_salary', width: 15 },
      { header: 'Dias Trab.', key: 'worked_days', width: 10 },
      { header: 'Faltas', key: 'absent_days', width: 10 },
      { header: 'Vacaciones', key: 'vacation_days', width: 12 },
      { header: 'Descanso medico', key: 'medical_leave_days', width: 16 },
      { header: 'Permiso sin goce', key: 'permission_unpaid_days', width: 16 },
      { header: 'Dsc. Faltas', key: 'absence_discount', width: 15 },
      { header: 'Dsc. Permiso', key: 'unpaid_permission_discount', width: 15 },
      { header: 'Tardanzas (min)', key: 'late_minutes', width: 15 },
      { header: 'Dsc. Tardanzas', key: 'late_discount', width: 15 },
      { header: 'Horas efectivas', key: 'worked_minutes', width: 15 },
      { header: 'Neto a Pagar', key: 'net_estimated_amount', width: 20 }
    ];

    recordsRes.rows.forEach((row) => worksheet.addRow(row));
    worksheet.getRow(1).font = { bold: true };

    return workbook.xlsx.writeBuffer();
  }

  async getMyPaystubs(tenantId, userId) {
    const workerRes = await query(
      `SELECT id
       FROM workers
       WHERE user_id = $1
         AND company_id = $2`,
      [userId, tenantId]
    );
    if (workerRes.rows.length === 0) return [];
    const workerId = workerRes.rows[0].id;

    const res = await query(`
      SELECT pr.*, pp.name AS period_name, pp.month, pp.year, pp.status AS period_status
      FROM payroll_records pr
      JOIN payroll_periods pp ON pr.payroll_period_id = pp.id
      WHERE pr.worker_id = $1
        AND pr.company_id = $2
      ORDER BY pp.year DESC, pp.month DESC
    `, [workerId, tenantId]);

    return res.rows;
  }
}

module.exports = new PayrollService();
