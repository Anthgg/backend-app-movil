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
      status_label: 'Aprobada'
    });
  });

  test('enriquece filas de listado sin perder datos existentes', () => {
    const row = requestService.enrichRequestRow({
      id: '33333333-3333-4333-8333-333333333333',
      request_code: 'F-RRHH-SOL-VAC-000001',
      worker_name: 'Ana Perez',
      type_code: 'MEDICAL_LEAVE',
      type_name: 'Descanso médico',
      status: 'observed'
    });

    expect(row).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      request_code: 'F-RRHH-SOL-VAC-000001',
      worker_name: 'Ana Perez',
      type: 'MEDICAL_LEAVE',
      status: 'observed',
      statusLabel: 'Observada',
      status_label: 'Observada'
    });
  });
});
