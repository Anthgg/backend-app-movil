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
      generatedDays: 61.67,
      usedDays: 15,
      reservedDays: 5,
      availableDays: 41.67,
      nextAccrualDate: '2026-06-22',
      nextServiceAnniversary: '2027-06-01',
      calculationMode: 'service_months_and_days_prorated'
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

  test('permite evaluar una solicitud mayor al saldo para decision del encargado', () => {
    const assessment = vacationService.buildRequestAssessment({ availableDays: 5 }, 7);

    expect(assessment).toEqual({
      availableDaysAtRequest: 5,
      requestedDays: 7,
      projectedAvailableDays: -2,
      exceedsAvailableBalance: true,
      requiresManagerOverride: true
    });
  });

  test('calcula vacaciones truncas si el trabajador cesa antes del aniversario', () => {
    const accrual = vacationService.calculateAccruedVacation('2026-01-01', '2026-04-16');

    expect(accrual).toEqual({
      generatedDays: 8.75,
      completedServiceMonths: 3,
      remainingServiceDays: 15,
      dailyAccrualRate: 0.083333
    });
  });

  test('un saldo negativo se recupera progresivamente con el devengo diario', () => {
    const initial = vacationService.calculateAccruedVacation('2026-01-01', '2026-03-01');
    const later = vacationService.calculateAccruedVacation('2026-01-01', '2026-04-01');

    expect(initial.generatedDays - 7).toBe(-2);
    expect(later.generatedDays - 7).toBe(0.5);
  });
});
