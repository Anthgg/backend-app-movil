jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

const { query } = require('../../src/config/database');
const vacationService = require('../../src/services/request-service/services/vacation.service');

describe('Saldo vacacional por años completos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T12:00:00-05:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('reserva pendientes y descuenta aprobadas sin tratarlas como faltas', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ hire_date: '2024-06-01' }] })
      .mockResolvedValueOnce({
        rows: [
          { status: 'approved', total_days: '15' },
          { status: 'pending', total_days: '5' }
        ]
      });

    const balance = await vacationService.getVacationBalance('worker-id', 'company-id');

    expect(balance).toMatchObject({
      generatedDays: 60,
      usedDays: 15,
      reservedDays: 5,
      availableDays: 40,
      nextAccrualDate: '2027-06-01',
      calculationMode: 'completed_service_years_calendar_days'
    });
  });

  test('usa el código contractual de saldo insuficiente', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ hire_date: '2025-06-01' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'approved', total_days: '25' }] });

    await expect(
      vacationService.checkVacationBalance('worker-id', 'company-id', 10)
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'INSUFFICIENT_VACATION_DAYS'
    });
  });
});
