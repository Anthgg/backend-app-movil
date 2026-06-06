const {
  validateCompleteProfilePayload,
  validateOnboardingPayload
} = require('../../src/services/onboarding-service/validators');
const { normalizeCompleteProfilePayload } = require('../../src/normalizers/worker-payload.normalizer');
const {
  mapCompleteProfileGetResponse,
  mapCompleteProfilePutResponse,
  mapUserRole
} = require('../../src/mappers/worker.mapper');

describe('Complete profile validator', () => {
  const companyId = '11111111-1111-4111-8111-111111111111';

  test('accepts entryDate as alias for startDate', () => {
    const errors = validateCompleteProfilePayload({
      laborData: {
        companyId,
        entryDate: '2026-06-01'
      }
    }, companyId);

    expect(errors).toEqual([]);
  });

  test('rejects invalid entryDate values', () => {
    const errors = validateCompleteProfilePayload({
      laborData: {
        companyId,
        entryDate: 'not-a-date'
      }
    }, companyId);

    expect(errors).toEqual([
      expect.objectContaining({ field: 'laborData.startDate' })
    ]);
  });

  test('accepts crewId in complete-profile payloads', () => {
    const crewId = '22222222-2222-4222-8222-222222222222';
    const errors = validateCompleteProfilePayload({
      labor_data: {
        company_id: companyId,
        crew_id: crewId,
        entry_date: '2026-06-01'
      }
    }, companyId);

    expect(errors).toEqual([]);
    expect(normalizeCompleteProfilePayload({
      labor_data: {
        company_id: companyId,
        crew_id: crewId,
        entry_date: '2026-06-01'
      }
    }).laborData.crewId).toBe(crewId);
  });

  test('validates crewId in onboarding payloads', () => {
    const crewId = '22222222-2222-4222-8222-222222222222';
    const errors = validateOnboardingPayload({
      personalData: {
        dni: '71815063',
        firstName: 'Juan',
        paternalLastName: 'Perez'
      },
      laborData: {
        companyId,
        areaId: '44444444-4444-4444-8444-444444444444',
        positionId: '55555555-5555-4555-8555-555555555555',
        workLocationId: '66666666-6666-4666-8666-666666666666',
        crewId,
        startDate: '2026-06-01',
        requiresAttendance: false
      },
      contractData: {
        contractType: 'temporal',
        startDate: '2026-06-01'
      }
    }, companyId);

    expect(errors).toEqual([]);
  });

  test('rejects invalid crewId format in validators', () => {
    const errors = validateCompleteProfilePayload({
      laborData: {
        companyId,
        crewId: 'PENDIENTE-123',
        entryDate: '2026-06-01'
      }
    }, companyId);

    expect(errors).toEqual([
      expect.objectContaining({ field: 'laborData.crewId' })
    ]);
  });

  test('maps assigned role identifiers and readable role data into complete-profile user', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const roleId = '33333333-3333-4333-8333-333333333333';
    const data = mapCompleteProfileGetResponse({
      user: {
        id: userId,
        first_name: 'Juan',
        last_name: 'Perez',
        email: 'juan.perez@empresa.com',
        username: 'juan.perez',
        role_id: roleId,
        role_name: 'Supervisor',
        role_code: 'supervisor'
      },
      worker: null,
      tenantId: companyId,
      catalogs: {}
    });

    expect(data.user.role_id).toBe(roleId);
    expect(data.user.roleId).toBe(roleId);
    expect(data.user.role).toEqual({
      id: roleId,
      uuid: roleId,
      name: 'Supervisor',
      code: 'supervisor'
    });
    expect(data.user.username).toBe('juan.perez');
    expect(data.user.corporateEmail).toBe('juan.perez@empresa.com');
    expect(data.user.systemRole.id).toBe(roleId);
  });

  test('maps null role fields when complete-profile user has no assigned role', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    expect(mapUserRole({ id: userId })).toBeNull();

    const data = mapCompleteProfileGetResponse({
      user: { id: userId },
      worker: null,
      tenantId: companyId,
      catalogs: {}
    });

    expect(data.user.role_id).toBeNull();
    expect(data.user.roleId).toBeNull();
    expect(data.user.role).toBeNull();
    expect(data.user.systemRole).toBeNull();
  });

  test('maps crew data into complete-profile responses', () => {
    const workerId = '77777777-7777-4777-8777-777777777777';
    const userId = '11111111-1111-4111-8111-111111111111';
    const crewId = '22222222-2222-4222-8222-222222222222';
    const workLocationId = '66666666-6666-4666-8666-666666666666';

    const getData = mapCompleteProfileGetResponse({
      user: { id: userId },
      worker: {
        id: workerId,
        user_id: userId,
        company_id: companyId,
        work_location_id: workLocationId,
        crew_id: crewId,
        crew_name: 'Cuadrilla Principal'
      },
      tenantId: companyId,
      catalogs: {}
    });

    expect(getData.labor_data.crew_id).toBe(crewId);
    expect(getData.labor_data.crewId).toBe(crewId);
    expect(getData.labor_data.crew_name).toBe('Cuadrilla Principal');

    const putData = mapCompleteProfilePutResponse({
      userId,
      worker: {
        id: workerId,
        user_id: userId,
        document_number: '71815063',
        personal_id: '71815063',
        work_location_id: workLocationId,
        crew_id: crewId,
        crew_name: 'Cuadrilla Principal'
      }
    });

    expect(putData.crew_id).toBe(crewId);
    expect(putData.crewId).toBe(crewId);
    expect(putData.work_location_id).toBe(workLocationId);
  });
});
