const { mapWorkerListItem } = require('../../src/mappers/worker.mapper');

const WORKER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const POSITION_ID = '44444444-4444-4444-8444-444444444444';
const AREA_ID = '55555555-5555-4555-8555-555555555555';
const DEPARTMENT_ID = '66666666-6666-4666-8666-666666666666';
const WORK_LOCATION_ID = '77777777-7777-4777-8777-777777777777';
const CREW_ID = '88888888-8888-4888-8888-888888888888';

function createWorkerRow(overrides = {}) {
  return {
    id: WORKER_ID,
    worker_id: WORKER_ID,
    user_id: USER_ID,
    first_name: 'Ana',
    paternal_last_name: 'Torres',
    document_number: '77665545',
    personal_email: 'ana.personal@fabryor.com',
    email: 'ana.torres@fabryor.com',
    phone_number: '911223344',
    role_id: ROLE_ID,
    role_name: 'Trabajador',
    role_code: 'worker',
    position_id: POSITION_ID,
    position_name: 'Coordinador Administrativo',
    area_id: AREA_ID,
    area_name: 'Administracion',
    internal_department_id: DEPARTMENT_ID,
    internal_department_name: 'Administracion',
    work_location_id: WORK_LOCATION_ID,
    work_location_name: 'Obra prueba',
    crew_id: CREW_ID,
    crew_name: 'Cuadrilla Principal',
    employment_status: 'active',
    profile_status: 'complete',
    is_profile_complete: true,
    created_at: '2026-06-07T04:20:12.000Z',
    updated_at: '2026-06-07T04:20:12.000Z',
    ...overrides
  };
}

describe('mapWorkerListItem', () => {
  test('homologa trabajador completo con relaciones laborales y rol', () => {
    const item = mapWorkerListItem(createWorkerRow());

    expect(item).toMatchObject({
      id: WORKER_ID,
      workerId: WORKER_ID,
      userId: USER_ID,
      fullName: 'Ana Torres',
      documentNumber: '77665545',
      email: 'ana.torres@fabryor.com',
      phone: '911223344',
      roleId: ROLE_ID,
      roleName: 'Trabajador',
      roleCode: 'worker',
      positionId: POSITION_ID,
      positionName: 'Coordinador Administrativo',
      areaId: AREA_ID,
      areaName: 'Administracion',
      internalDepartmentId: DEPARTMENT_ID,
      internalDepartmentName: 'Administracion',
      workLocationId: WORK_LOCATION_ID,
      workLocationName: 'Obra prueba',
      crewId: CREW_ID,
      crewName: 'Cuadrilla Principal',
      status: 'active',
      profileStatus: 'complete',
      isProfileComplete: true
    });
  });

  test('mantiene cuadrilla nula sin omitir propiedades', () => {
    const item = mapWorkerListItem(createWorkerRow({
      crew_id: null,
      crew_name: null
    }));

    expect(item.crewId).toBeNull();
    expect(item.crewName).toBeNull();
    expect(item).toHaveProperty('crew_id', null);
    expect(item).toHaveProperty('crew_name', null);
  });

  test('devuelve user y rol nulos cuando no existe usuario', () => {
    const item = mapWorkerListItem(createWorkerRow({
      user_id: null,
      role_id: null,
      role_name: null,
      role_code: null
    }));

    expect(item.userId).toBeNull();
    expect(item.roleId).toBeNull();
    expect(item.roleName).toBeNull();
    expect(item.roleCode).toBeNull();
  });

  test('preserva rol personalizado', () => {
    const item = mapWorkerListItem(createWorkerRow({
      role_name: 'Contabilidad',
      role_code: 'contabilidad'
    }));

    expect(item.roleName).toBe('Contabilidad');
    expect(item.roleCode).toBe('contabilidad');
  });

  test('marca ficha incompleta cuando falta obra', () => {
    const item = mapWorkerListItem(createWorkerRow({
      work_location_id: null,
      work_location_name: null,
      profile_status: 'incomplete',
      is_profile_complete: false
    }));

    expect(item.workLocationId).toBeNull();
    expect(item.workLocationName).toBeNull();
    expect(item.profileStatus).toBe('incomplete');
    expect(item.isProfileComplete).toBe(false);
  });

  test('no usa valores documentales pendientes como identificadores internos', () => {
    const item = mapWorkerListItem(createWorkerRow({
      id: 'PENDIENTE-12345',
      worker_id: 'PENDIENTE-12345',
      user_id: 'PENDIENTE-67890',
      document_number: 'PENDIENTE-12345'
    }));

    expect(item.id).toBeNull();
    expect(item.workerId).toBeNull();
    expect(item.userId).toBeNull();
    expect(item.documentNumber).toBe('PENDIENTE-12345');
  });
});
