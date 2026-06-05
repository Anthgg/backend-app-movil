const { validateCompleteProfilePayload } = require('../../src/services/onboarding-service/validators');
const {
  mapCompleteProfileGetResponse,
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

  test('maps assigned role identifiers and readable role data into complete-profile user', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const roleId = '33333333-3333-4333-8333-333333333333';
    const data = mapCompleteProfileGetResponse({
      user: {
        id: userId,
        first_name: 'Juan',
        last_name: 'Perez',
        email: 'juan.perez@empresa.com',
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
});
