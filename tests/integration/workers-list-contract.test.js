const request = require('supertest');
const app = require('../../src/app');
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
});
