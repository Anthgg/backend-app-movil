const assignmentGuard = require('../../src/shared/services/worker-assignment-guard.service');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';
const CURRENT_CREW_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_CREW_ID = '44444444-4444-4444-8444-444444444444';
const CURRENT_LOCATION_ID = '55555555-5555-4555-8555-555555555555';
const TARGET_LOCATION_ID = '66666666-6666-4666-8666-666666666666';
const CURRENT_SUPERVISOR_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_SUPERVISOR_ID = '88888888-8888-4888-8888-888888888888';
const CURRENT_PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function createFakeDb({
  worker = {},
  activeCrew = null,
  activeLocationAssignment = null,
  activeProject = null,
  targetCrew = { id: TARGET_CREW_ID, work_location_id: TARGET_LOCATION_ID }
} = {}) {
  return {
    query: jest.fn(async (sql, params = []) => {
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'project_id' },
            { column_name: 'supervisor_id' }
          ],
          rowCount: 2
        };
      }

      if (sql.includes('FROM work_crews') && sql.includes('WHERE id = $1') && !sql.includes('crew_workers')) {
        return targetCrew
          ? { rows: [targetCrew], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.includes('FROM workers w')) {
        return {
          rows: [
            {
              id: WORKER_ID,
              company_id: COMPANY_ID,
              user_id: '99999999-9999-4999-8999-999999999999',
              work_location_id: worker.work_location_id || null,
              project_id: worker.project_id || null,
              supervisor_id: worker.supervisor_id || null,
              is_active: true,
              employment_status: 'active'
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes('FROM crew_workers cw')) {
        return activeCrew
          ? { rows: [activeCrew], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.includes('FROM worker_location_assignments')) {
        return activeLocationAssignment
          ? { rows: [activeLocationAssignment], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.includes('FROM project_assignments')) {
        return activeProject
          ? { rows: [activeProject], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
    })
  };
}

describe('worker assignment guard', () => {
  test('allows assigning an available worker to a crew', async () => {
    const db = createFakeDb();

    const snapshot = await assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      actor: { id: OTHER_SUPERVISOR_ID, roles: ['SUPERVISOR'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      operation: 'normal',
      dbClient: db
    });

    expect(snapshot.assignmentStatus).toBe('available');
  });

  test('blocks normal assignment when a busy worker is moved by an unauthorized user', async () => {
    const db = createFakeDb({
      worker: { work_location_id: CURRENT_LOCATION_ID }
    });

    await expect(assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      actor: { id: OTHER_SUPERVISOR_ID, roles: ['SUPERVISOR'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      operation: 'normal',
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'WORKER_ALREADY_ASSIGNED',
      details: {
        workerId: WORKER_ID,
        currentWorkLocationId: CURRENT_LOCATION_ID,
        requestedWorkLocationId: TARGET_LOCATION_ID,
        requestedCrewId: TARGET_CREW_ID
      }
    });
  });

  test('allows an admin to reassign a busy worker', async () => {
    const db = createFakeDb({
      worker: { work_location_id: CURRENT_LOCATION_ID }
    });

    await expect(assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      actor: { id: OTHER_SUPERVISOR_ID, roles: ['ADMIN'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      operation: 'reassign',
      dbClient: db
    })).resolves.toMatchObject({
      assignmentStatus: 'busy'
    });
  });

  test('treats an active project assignment as a busy worker conflict', async () => {
    const db = createFakeDb({
      activeProject: { project_id: CURRENT_PROJECT_ID }
    });

    await expect(assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      actor: { id: OTHER_SUPERVISOR_ID, roles: ['SUPERVISOR'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      operation: 'normal',
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'WORKER_ALREADY_ASSIGNED',
      details: {
        currentProjectId: CURRENT_PROJECT_ID,
        requestedCrewId: TARGET_CREW_ID
      }
    });
  });

  test('allows the current supervisor to reassign a busy worker', async () => {
    const db = createFakeDb({
      activeCrew: {
        crew_id: CURRENT_CREW_ID,
        work_location_id: CURRENT_LOCATION_ID,
        supervisor_id: CURRENT_SUPERVISOR_ID
      }
    });

    await expect(assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      actor: { id: CURRENT_SUPERVISOR_ID, roles: ['SUPERVISOR'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      operation: 'reassign',
      dbClient: db
    })).resolves.toMatchObject({
      currentCrewId: CURRENT_CREW_ID,
      currentSupervisorId: CURRENT_SUPERVISOR_ID
    });
  });

  test('rejects formal reassignment by another supervisor', async () => {
    const db = createFakeDb({
      activeCrew: {
        crew_id: CURRENT_CREW_ID,
        work_location_id: CURRENT_LOCATION_ID,
        supervisor_id: CURRENT_SUPERVISOR_ID
      }
    });

    await expect(assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      actor: { id: OTHER_SUPERVISOR_ID, roles: ['SUPERVISOR'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      operation: 'reassign',
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'WORKER_REASSIGN_FORBIDDEN'
    });
  });

  test('rejects assigning a worker to the same active crew', async () => {
    const db = createFakeDb({
      activeCrew: {
        crew_id: TARGET_CREW_ID,
        work_location_id: TARGET_LOCATION_ID,
        supervisor_id: CURRENT_SUPERVISOR_ID
      }
    });

    await expect(assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      actor: { id: CURRENT_SUPERVISOR_ID, roles: ['SUPERVISOR'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      operation: 'normal',
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'WORKER_ALREADY_IN_CREW'
    });
  });

  test('rejects invalid worker IDs before querying assignments', async () => {
    const db = createFakeDb();

    await expect(assignmentGuard.assertWorkerCanAssignToTarget({
      workerId: 'invalid',
      companyId: COMPANY_ID,
      actor: { id: OTHER_SUPERVISOR_ID, roles: ['ADMIN'], permissions: [] },
      targetCrewId: TARGET_CREW_ID,
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_WORKER_ID'
    });
  });
});
