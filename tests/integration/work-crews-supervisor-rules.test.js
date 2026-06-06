const supervisorRules = require('../../src/modules/workCrews/supervisorRules.service');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const SUPERVISOR_ID = '22222222-2222-4222-8222-222222222222';
const CREW_ID = '33333333-3333-4333-8333-333333333333';

function createFakeDb({ rulesRow = null, supervisorRow = null, crewCount = 0, rulesError = null } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM company_rules')) {
        if (rulesError) throw rulesError;
        return { rows: rulesRow ? [rulesRow] : [], rowCount: rulesRow ? 1 : 0 };
      }

      if (sql.includes('FROM users u')) {
        return { rows: supervisorRow ? [supervisorRow] : [], rowCount: supervisorRow ? 1 : 0 };
      }

      if (sql.includes('COUNT(*)::int AS total')) {
        return { rows: [{ total: crewCount }], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    })
  };
}

function supervisor(roleCode = 'SUPERVISOR') {
  return {
    user_id: SUPERVISOR_ID,
    company_id: COMPANY_ID,
    role_id: '44444444-4444-4444-8444-444444444444',
    role_code: roleCode,
    role_name: roleCode
  };
}

describe('work crew supervisor rules', () => {
  test('uses default company rules when the rules table is missing', async () => {
    const db = createFakeDb({
      rulesError: { code: '42P01' }
    });

    await expect(supervisorRules.getCompanySupervisorRules(COMPANY_ID, db)).resolves.toEqual({
      max_crews_per_supervisor: 2,
      exceed_action: 'block',
      allowed_roles_for_supervisor: ['supervisor']
    });
  });

  test('rejects invalid supervisor UUIDs with 400', async () => {
    const db = createFakeDb();

    await expect(supervisorRules.validateSupervisorAssignment({
      supervisorId: 'invalid-id',
      companyId: COMPANY_ID,
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_SUPERVISOR_ID'
    });
  });

  test('rejects supervisors that do not exist or are not active in the company', async () => {
    const db = createFakeDb();

    await expect(supervisorRules.validateSupervisorAssignment({
      supervisorId: SUPERVISOR_ID,
      companyId: COMPANY_ID,
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'SUPERVISOR_NOT_FOUND'
    });
  });

  test('rejects users whose role is not allowed by company rules', async () => {
    const db = createFakeDb({
      rulesRow: {
        max_crews_per_supervisor: 2,
        exceed_action: 'block',
        allowed_roles_for_supervisor: ['supervisor']
      },
      supervisorRow: supervisor('WORKER')
    });

    await expect(supervisorRules.validateSupervisorAssignment({
      supervisorId: SUPERVISOR_ID,
      companyId: COMPANY_ID,
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'SUPERVISOR_ROLE_NOT_ALLOWED',
      details: {
        allowedRoles: ['supervisor'],
        currentRole: 'worker'
      }
    });
  });

  test('accepts supervisors when any assigned role is allowed', async () => {
    const db = createFakeDb({
      rulesRow: {
        max_crews_per_supervisor: 2,
        exceed_action: 'block',
        allowed_roles_for_supervisor: ['supervisor']
      },
      supervisorRow: {
        ...supervisor('WORKER'),
        role_codes: ['worker', 'supervisor'],
        role_names: ['trabajador', 'supervisor']
      }
    });

    const result = await supervisorRules.validateSupervisorAssignment({
      supervisorId: SUPERVISOR_ID,
      companyId: COMPANY_ID,
      dbClient: db
    });

    expect(result.warnings).toEqual([]);
  });

  test('blocks assignment when the supervisor reaches the crew limit and action is block', async () => {
    const db = createFakeDb({
      rulesRow: {
        max_crews_per_supervisor: 2,
        exceed_action: 'block',
        allowed_roles_for_supervisor: ['supervisor']
      },
      supervisorRow: supervisor(),
      crewCount: 2
    });

    await expect(supervisorRules.validateSupervisorAssignment({
      supervisorId: SUPERVISOR_ID,
      companyId: COMPANY_ID,
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'SUPERVISOR_CREWS_LIMIT_EXCEEDED',
      details: {
        supervisorId: SUPERVISOR_ID,
        currentCrews: 2,
        maxCrews: 2
      }
    });
  });

  test('returns a warning when the supervisor reaches the crew limit and action is warn', async () => {
    const db = createFakeDb({
      rulesRow: {
        max_crews_per_supervisor: 2,
        exceed_action: 'warn',
        allowed_roles_for_supervisor: ['supervisor']
      },
      supervisorRow: supervisor(),
      crewCount: 2
    });

    const result = await supervisorRules.validateSupervisorAssignment({
      supervisorId: SUPERVISOR_ID,
      companyId: COMPANY_ID,
      dbClient: db
    });

    expect(result.warnings).toEqual([
      {
        code: 'SUPERVISOR_CREWS_LIMIT_WARNING',
        message: 'El supervisor supera el limite recomendado de cuadrillas.',
        details: {
          supervisorId: SUPERVISOR_ID,
          currentCrews: 2,
          maxCrews: 2
        }
      }
    ]);
  });

  test('treats max_crews_per_supervisor 999 or more as no limit', async () => {
    const db = createFakeDb({
      rulesRow: {
        max_crews_per_supervisor: 999,
        exceed_action: 'block',
        allowed_roles_for_supervisor: ['supervisor']
      },
      supervisorRow: supervisor(),
      crewCount: 999
    });

    const result = await supervisorRules.validateSupervisorAssignment({
      supervisorId: SUPERVISOR_ID,
      companyId: COMPANY_ID,
      dbClient: db
    });

    expect(result.warnings).toEqual([]);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('COUNT(*)::int AS total'))).toBe(false);
  });

  test('excludes the current crew from the supervisor count on update', async () => {
    const db = createFakeDb({
      rulesRow: {
        max_crews_per_supervisor: 2,
        exceed_action: 'block',
        allowed_roles_for_supervisor: ['supervisor']
      },
      supervisorRow: supervisor(),
      crewCount: 1
    });

    await supervisorRules.validateSupervisorAssignment({
      supervisorId: SUPERVISOR_ID,
      companyId: COMPANY_ID,
      excludeCrewId: CREW_ID,
      dbClient: db
    });

    const countCall = db.query.mock.calls.find(([sql]) => sql.includes('COUNT(*)::int AS total'));
    expect(countCall[0]).toContain('AND id <> $3');
    expect(countCall[1]).toEqual([SUPERVISOR_ID, COMPANY_ID, CREW_ID]);
  });
});
