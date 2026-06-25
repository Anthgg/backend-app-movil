const requestService = require('../../src/services/request-service/services/request.service');

describe('Request status contract', () => {
  test.each([
    ['pending', 'pending'],
    ['Pendiente', 'pending'],
    ['APROBADA', 'approved'],
    ['rechazado', 'rejected'],
    ['pendiente rrhh', 'pending_rrhh'],
    ['observada', 'observed'],
    ['cancelada', 'cancelled']
  ])('normaliza estado de solicitud %s como %s', (input, expected) => {
    expect(requestService.normalizeRequestStatus(input)).toBe(expected);
  });

  test('serializa solicitud con statusKey y statusLabel para web', () => {
    const serialized = requestService.serializeRequest({
      id: '11111111-1111-4111-8111-111111111111',
      request_type_id: '22222222-2222-4222-8222-222222222222',
      type_code: 'VACATION',
      type_name: 'Vacaciones',
      status: 'approved',
      start_date: '2026-06-17',
      end_date: '2026-06-18',
      reason: 'QA'
    });

    expect(serialized).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'VACATION',
      status: 'approved',
      statusKey: 'approved',
      status_key: 'approved',
      statusLabel: 'Aprobada',
      status_label: 'Aprobada',
      startDate: '2026-06-17',
      start_date: '2026-06-17',
      startDateKey: '2026-06-17',
      start_date_key: '2026-06-17',
      startCalendarDate: '2026-06-17',
      start_calendar_date: '2026-06-17',
      startDisplayDate: '17/06/2026',
      start_display_date: '17/06/2026',
      endDate: '2026-06-18',
      end_date: '2026-06-18',
      endDisplayDate: '18/06/2026',
      end_display_date: '18/06/2026'
    });
    expect(serialized.startCalendarDateTime).toContain('2026-06-17T12:00:00');
    expect(serialized.endCalendarDateTime).toContain('2026-06-18T12:00:00');
  });

  test('enriquece filas de listado sin perder datos existentes', () => {
    const row = requestService.enrichRequestRow({
      id: '33333333-3333-4333-8333-333333333333',
      request_code: 'F-RRHH-SOL-VAC-000001',
      worker_name: 'Ana Perez',
      type_code: 'MEDICAL_LEAVE',
      type_name: 'Descanso médico',
      status: 'observed',
      start_date: '2026-06-23',
      end_date: '2026-06-23'
    });

    expect(row).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      request_code: 'F-RRHH-SOL-VAC-000001',
      worker_name: 'Ana Perez',
      type: 'MEDICAL_LEAVE',
      status: 'observed',
      statusLabel: 'Observada',
      status_label: 'Observada',
      startDate: '2026-06-23',
      start_date: '2026-06-23',
      startDisplayDate: '23/06/2026',
      endDate: '2026-06-23',
      end_date: '2026-06-23',
      endDisplayDate: '23/06/2026'
    });
    expect(row.startCalendarDateTime).toContain('2026-06-23T12:00:00');
    expect(row.endCalendarDateTime).toContain('2026-06-23T12:00:00');
  });

  test('mantiene el 23 de junio como fecha local segura para solicitudes web', () => {
    const row = requestService.enrichRequestRow({
      id: '44444444-4444-4444-8444-444444444444',
      type_code: 'DESCANSO_MEDICO',
      type_name: 'Descanso médico',
      status: 'approved',
      start_date: new Date('2026-06-23T00:00:00.000Z'),
      end_date: new Date('2026-06-23T00:00:00.000Z')
    });

    expect(row).toMatchObject({
      startDate: '2026-06-23',
      start_date: '2026-06-23',
      startDateKey: '2026-06-23',
      start_date_key: '2026-06-23',
      startCalendarDate: '2026-06-23',
      start_calendar_date: '2026-06-23',
      startDisplayDate: '23/06/2026',
      endDate: '2026-06-23',
      end_date: '2026-06-23',
      endDateKey: '2026-06-23',
      end_date_key: '2026-06-23',
      endCalendarDate: '2026-06-23',
      end_calendar_date: '2026-06-23',
      endDisplayDate: '23/06/2026'
    });
    expect(row.startCalendarDateTime).toContain('2026-06-23T12:00:00');
    expect(row.endCalendarDateTime).toContain('2026-06-23T12:00:00');
  });
});
