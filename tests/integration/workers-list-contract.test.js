const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const { loginAsAdmin } = require('../helpers/auth.helper');
const { isValidUUID } = require('../../src/utils/uuid.util');

const CONTRACT_FIELDS = [
  'id',
  'workerId',
  'userId',
  'fullName',
  'documentNumber',
  'email',
  'phone',
  'roleId',
  'roleName',
  'roleCode',
  'positionId',
  'positionName',
  'areaId',
  'areaName',
  'internalDepartmentId',
  'internalDepartmentName',
  'workLocationId',
  'workLocationName',
  'crewId',
  'crewName',
  'status',
  'profileStatus',
  'isProfileComplete',
  'createdAt',
  'updatedAt'
];

function expectUuidOrNull(value) {
  expect(value === null || isValidUUID(value)).toBe(true);
}

describe('GET /api/workers contract', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await loginAsAdmin(app);
  });

  test('devuelve listado homologado en camelCase con aliases compatibles', async () => {
    const res = await request(app)
      .get('/api/workers?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 5
    });

    res.body.data.forEach((worker) => {
      CONTRACT_FIELDS.forEach((field) => {
        expect(worker).toHaveProperty(field);
      });

      expect(worker.id).toBe(worker.workerId);
      expectUuidOrNull(worker.id);
      expectUuidOrNull(worker.workerId);
      expectUuidOrNull(worker.userId);
      expectUuidOrNull(worker.roleId);
      expectUuidOrNull(worker.positionId);
      expectUuidOrNull(worker.areaId);
      expectUuidOrNull(worker.internalDepartmentId);
      expectUuidOrNull(worker.workLocationId);
      expectUuidOrNull(worker.crewId);

      expect(String(worker.id || '')).not.toMatch(/^PENDIENTE-/);
      expect(String(worker.workerId || '')).not.toMatch(/^PENDIENTE-/);
      expect(String(worker.userId || '')).not.toMatch(/^PENDIENTE-/);
      expect(['complete', 'incomplete']).toContain(worker.profileStatus);
      expect(typeof worker.isProfileComplete).toBe('boolean');
    });
  });

  test('resuelve cuadrilla desde la obra cuando la obra tiene una sola cuadrilla activa', async () => {
    const res = await request(app)
      .get('/api/workers?limit=50')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);

    const locationCrews = await query(`
      SELECT wl.id AS work_location_id,
             COUNT(wc.id)::int AS active_crews,
             MIN(wc.id::text) AS crew_id,
             MIN(wc.name) AS crew_name
      FROM work_locations wl
      JOIN work_crews wc
        ON wc.work_location_id = wl.id
       AND wc.company_id = wl.company_id
       AND wc.deleted_at IS NULL
       AND COALESCE(wc.is_active, wc.status, TRUE) = TRUE
      WHERE wl.deleted_at IS NULL
      GROUP BY wl.id
    `);
    const uniqueCrewByLocation = new Map(
      locationCrews.rows
        .filter((row) => row.active_crews === 1)
        .map((row) => [row.work_location_id, row])
    );

    const workersWithUniqueLocationCrew = res.body.data.filter((worker) => (
      worker.workLocationId && uniqueCrewByLocation.has(worker.workLocationId)
    ));

    expect(workersWithUniqueLocationCrew.length).toBeGreaterThan(0);
    workersWithUniqueLocationCrew.forEach((worker) => {
      const expectedCrew = uniqueCrewByLocation.get(worker.workLocationId);
      expect(worker.crewId).toBe(expectedCrew.crew_id);
      expect(worker.crewName).toBe(expectedCrew.crew_name);
    });
  });
});
