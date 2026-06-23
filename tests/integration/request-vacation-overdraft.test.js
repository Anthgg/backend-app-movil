jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn()
}));

jest.mock('../../src/services/request-service/services/vacation.service', () => ({
  assessVacationRequest: jest.fn()
}));

jest.mock('../../src/shared/utils/notifications', () => ({
  createNotification: jest.fn(),
  createNotificationsForUsers: jest.fn().mockResolvedValue(undefined),
  getCompanyNotificationRecipients: jest.fn().mockResolvedValue([])
}));

const { query, withTransaction } = require('../../src/config/database');
const vacationService = require('../../src/services/request-service/services/vacation.service');
const requestService = require('../../src/services/request-service/services/request.service');

describe('Solicitud de vacaciones con sobregiro', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('crea la solicitud pendiente y guarda la advertencia para el encargado', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'type-id', name: 'VACACIONES', code: 'VACATION' }]
      })
      .mockResolvedValueOnce({ rows: [{ hire_date: '2025-01-01' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    vacationService.assessVacationRequest.mockResolvedValue({
      availableDaysAtRequest: 5,
      requestedDays: 7,
      projectedAvailableDays: -2,
      exceedsAvailableBalance: true,
      requiresManagerOverride: true
    });

    let insertParams;
    const db = {
      query: jest.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('INSERT INTO employee_requests')) {
          insertParams = params;
          return { rows: [{ id: 'request-id', status: 'pending' }] };
        }
        throw new Error(`Consulta inesperada: ${sql}`);
      })
    };
    withTransaction.mockImplementation((callback) => callback(db));

    const result = await requestService.createRequest({
      workerId: 'worker-id',
      tenantId: 'company-id',
      request_type_id: 'type-id',
      start_date: '2026-07-01',
      end_date: '2026-07-07',
      reason: 'Solicitud sujeta a aprobación'
    });

    expect(result).toMatchObject({ id: 'request-id', status: 'pending' });
    expect(vacationService.assessVacationRequest).toHaveBeenCalledWith(
      'worker-id',
      'company-id',
      7
    );
    expect(JSON.parse(insertParams[7])).toEqual({
      vacationBalance: {
        availableDaysAtRequest: 5,
        requestedDays: 7,
        projectedAvailableDays: -2,
        exceedsAvailableBalance: true,
        requiresManagerOverride: true
      }
    });
  });

  test('crea la solicitud aunque la base todavia no tenga employee_requests.metadata', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'type-id', name: 'VACACIONES', code: 'VACATION' }]
      })
      .mockResolvedValueOnce({ rows: [{ hire_date: '2025-01-01' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    vacationService.assessVacationRequest.mockResolvedValue({
      availableDaysAtRequest: 5,
      requestedDays: 7,
      projectedAvailableDays: -2,
      exceedsAvailableBalance: true,
      requiresManagerOverride: true
    });

    let insertSql;
    let insertParams;
    const db = {
      query: jest.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('INSERT INTO employee_requests')) {
          insertSql = sql;
          insertParams = params;
          return { rows: [{ id: 'request-id', status: 'pending' }] };
        }
        throw new Error(`Consulta inesperada: ${sql}`);
      })
    };
    withTransaction.mockImplementation((callback) => callback(db));

    const result = await requestService.createRequest({
      workerId: 'worker-id',
      tenantId: 'company-id',
      request_type_id: 'type-id',
      start_date: '2026-07-01',
      end_date: '2026-07-07',
      reason: 'Solicitud sujeta a aprobación'
    });

    expect(result).toMatchObject({ id: 'request-id', status: 'pending' });
    expect(insertSql).not.toContain('metadata');
    expect(insertParams).toEqual([
      'company-id',
      'worker-id',
      'type-id',
      '2026-07-01',
      '2026-07-07',
      7,
      'Solicitud sujeta a aprobación'
    ]);
  });
});
