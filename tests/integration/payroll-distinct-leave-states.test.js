jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/shared/services/attendance-day-status.service', () => ({
  getApprovedAttendanceDayCounts: jest.fn().mockResolvedValue({
    VACATION: 3,
    MEDICAL_LEAVE: 1,
    UNPAID_LEAVE: 2
  })
}));

const { query } = require('../../src/config/database');
const payrollService = require('../../src/services/payroll-service/services/payroll.service');

describe('Nómina con estados de licencia separados', () => {
  test('solo UNPAID_LEAVE descuenta y ABSENT conserva su contador propio', async () => {
    const period = {
      id: 'period-id',
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      status: 'draft'
    };
    let insertParameters;

    query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM payroll_periods')) return { rows: [period] };
      if (sql.includes('FROM payroll_settings')) return { rows: [] };
      if (sql.includes('DELETE FROM payroll_records')) return { rows: [] };
      if (sql.includes('FROM workers w')) {
        return {
          rows: [{
            id: 'worker-id',
            hire_date: '2025-01-01',
            contract_end_date: null,
            base_salary: 1500
          }]
        };
      }
      if (sql.includes('FROM attendance_records ar')) {
        return {
          rows: [{
            worked_days: 20,
            absent_days: 0,
            absent_minutes: 0,
            late_minutes: 0,
            worked_minutes: 9600,
            effective_worked_minutes: 9600,
            overtime_minutes: 0,
            holidays_worked_days: 0
          }]
        };
      }
      if (sql.includes('INSERT INTO payroll_records')) {
        insertParameters = params;
        return { rows: [{ id: 'payroll-record-id' }] };
      }
      if (sql.includes('UPDATE payroll_periods')) return { rows: [] };
      throw new Error(`Consulta inesperada: ${sql}`);
    });

    jest.spyOn(payrollService, 'calculateExpectedMinutes').mockResolvedValue(14400);

    await payrollService.generatePayroll('company-id', 'period-id', { id: 'user-id' });

    expect(insertParameters[7]).toBe(0); // absent_days
    expect(insertParameters[8]).toBe(3); // vacation_days
    expect(insertParameters[9]).toBe(1); // medical_leave_days
    expect(insertParameters[10]).toBe(2); // permission_unpaid_days
    expect(insertParameters[17]).toBe(100); // unpaid_permission_discount
    expect(insertParameters[19]).toBe(1400); // net_estimated_amount
    expect(insertParameters[20]).toMatchObject({
      absent_days: 0,
      vacation_days: 3,
      medical_leave_days: 1,
      unpaid_leave_days: 2,
      unpaid_leave_deduction: 100
    });
  });
});
