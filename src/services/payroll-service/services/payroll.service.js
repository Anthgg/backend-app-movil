const { query } = require('../../../config/database');
const reportService = require('../../report-service/services/report.service');
const ExcelJS = require('exceljs');
const moment = require('moment');

class PayrollService {
  
  async createPeriod(tenantId, data, user) {
    const overlap = await query(`SELECT id FROM payroll_periods WHERE company_id = $1 AND year = $2 AND month = $3`, [tenantId, data.year, data.month]);
    if (overlap.rows.length > 0) throw new Error('Ya existe un periodo para ese año y mes.');

    const res = await query(`
      INSERT INTO payroll_periods (company_id, name, year, month, start_date, end_date, generated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [tenantId, data.name, data.year, data.month, data.start_date, data.end_date, user.id]);
    return res.rows[0];
  }

  async getPeriods(tenantId) {
    const res = await query(`SELECT * FROM payroll_periods WHERE company_id = $1 ORDER BY year DESC, month DESC`, [tenantId]);
    return res.rows;
  }

  async generatePayroll(tenantId, periodId, user) {
    // 1. Validar Periodo
    const periodRes = await query(`SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2`, [periodId, tenantId]);
    if (periodRes.rows.length === 0) throw new Error('Periodo no encontrado.');
    const period = periodRes.rows[0];

    if (period.status === 'closed') throw new Error('No se puede generar o recalcular un periodo cerrado.');

    // 2. Traer Asistencias y Contratos
    const summaryData = await reportService.getMonthlySummaryData(tenantId, { start_date: period.start_date, end_date: period.end_date });
    
    await query(`DELETE FROM payroll_records WHERE payroll_period_id = $1`, [periodId]);

    let processedRecords = [];

    for (const row of summaryData) {
      // Obtener datos del trabajador y contrato
      const workerRes = await query(`
        SELECT w.hire_date, c.agreed_salary, c.end_date as contract_end_date
        FROM workers w
        LEFT JOIN worker_contracts c ON w.id = c.worker_id AND c.status = 'active'
        WHERE w.id = $1
      `, [row.worker_id]);

      const worker = workerRes.rows[0];
      const base_salary = parseFloat(worker?.agreed_salary || 1500);
      const daily_rate = base_salary / 30;

      // Cálculo de proporcionalidad
      const periodStart = moment(period.start_date);
      const periodEnd = moment(period.end_date);
      const hireDate = moment(worker.hire_date);
      const contractEndDate = worker.contract_end_date ? moment(worker.contract_end_date) : null;

      // Determinar inicio y fin computable para este trabajador en este periodo
      const computableStart = moment.max(periodStart, hireDate);
      const computableEnd = contractEndDate ? moment.min(periodEnd, contractEndDate) : periodEnd;

      let computableDays = computableEnd.diff(computableStart, 'days') + 1;
      if (computableDays < 0) computableDays = 0;

      // Sueldo proporcional (si no trabajó el mes completo por ingreso/cese)
      const totalPeriodDays = periodEnd.diff(periodStart, 'days') + 1;
      let proportionalSalary = base_salary;
      
      if (computableDays < totalPeriodDays) {
          proportionalSalary = daily_rate * computableDays;
      }

      const absent_days = parseInt(row.days_absent);
      const late_minutes = parseInt(row.total_late_minutes);
      
      const absence_discount = absent_days * daily_rate;
      const late_discount = late_minutes * 0.25; 
      const gross_amount = proportionalSalary;
      const net_estimated_amount = gross_amount - absence_discount - late_discount;

      const rec = await query(`
        INSERT INTO payroll_records (
          company_id, payroll_period_id, worker_id, base_salary, daily_rate, 
          worked_days, absent_days, late_minutes, 
          gross_amount, absence_discount, late_discount, net_estimated_amount, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'calculated') RETURNING *
      `, [
        tenantId, periodId, row.worker_id, base_salary, daily_rate,
        row.days_present, absent_days, late_minutes,
        gross_amount, absence_discount, late_discount, net_estimated_amount
      ]);

      processedRecords.push(rec.rows[0]);
    }

    await query(`UPDATE payroll_periods SET status = 'generated', updated_at = NOW() WHERE id = $1`, [periodId]);
    return processedRecords;
  }

  async recalculatePayroll(tenantId, periodId, user) {
    return await this.generatePayroll(tenantId, periodId, user);
  }

  async updatePeriodStatus(tenantId, periodId, newStatus, user) {
    const res = await query(`
      UPDATE payroll_periods 
      SET status = $1, updated_at = NOW(),
          approved_by = CASE WHEN $1 = 'approved' THEN $2::uuid ELSE approved_by END,
          approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
          closed_by = CASE WHEN $1 = 'closed' THEN $2::uuid ELSE closed_by END,
          closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE closed_at END
      WHERE id = $3 AND company_id = $4 RETURNING *
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
      WHERE p.payroll_period_id = $1 AND p.company_id = $2
    `, [periodId, tenantId]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Planilla Estimada');

    worksheet.columns = [
      { header: 'Trabajador Email', key: 'email', width: 25 },
      { header: 'Sueldo Base', key: 'base_salary', width: 15 },
      { header: 'Días Trab.', key: 'worked_days', width: 10 },
      { header: 'Faltas', key: 'absent_days', width: 10 },
      { header: 'Dsc. Faltas', key: 'absence_discount', width: 15 },
      { header: 'Tardanzas (min)', key: 'late_minutes', width: 15 },
      { header: 'Dsc. Tardanzas', key: 'late_discount', width: 15 },
      { header: 'Neto a Pagar', key: 'net_estimated_amount', width: 20 }
    ];

    recordsRes.rows.forEach(row => worksheet.addRow(row));
    worksheet.getRow(1).font = { bold: true };
    
    return await workbook.xlsx.writeBuffer();
  }

  async getMyPaystubs(tenantId, userId) {
    // Resolver worker_id
    const workerRes = await query('SELECT id FROM workers WHERE user_id = $1 AND company_id = $2', [userId, tenantId]);
    if (workerRes.rows.length === 0) return [];
    const workerId = workerRes.rows[0].id;

    const res = await query(`
      SELECT pr.*, pp.name as period_name, pp.month, pp.year, pp.status as period_status
      FROM payroll_records pr
      JOIN payroll_periods pp ON pr.payroll_period_id = pp.id
      WHERE pr.worker_id = $1 AND pr.company_id = $2
      ORDER BY pp.year DESC, pp.month DESC
    `, [workerId, tenantId]);

    return res.rows;
  }
}

module.exports = new PayrollService();
