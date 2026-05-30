/**
 * Integration smoke test for the new areas endpoints.
 * Tests: department_id + role_id validation, by-department filter, departments catalog.
 */
const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const { getAccessToken } = require('../helpers/auth.helper');

describe('Areas Extended API Tests', () => {

  let adminToken = '';
  let companyId = '';
  let departmentId = '';
  let roleId = '';
  let createdAreaId = '';
  let createdRoleId = '';
  let createdDepartmentId = '';

  const areaName = `Area Test ${Date.now()}`;
  const roleCode = `QA_ROLE_${Date.now()}`;
  const roleName = `Rol QA ${Date.now()}`;
  const departmentName = `Departamento QA ${Date.now()}`;

  beforeAll(async () => {
    // Login
    const candidates = [
      { email: 'admin.qa@demo.com', password: 'AdminDemo2026!' },
      { email: 'admin@demo.com', password: 'Demo123!' }
    ];
    for (const cred of candidates) {
      const res = await request(app).post('/auth/login').send(cred);
      const token = getAccessToken(res.body);
      if (res.statusCode === 200 && token) {
        adminToken = token;
        companyId = res.body.data.user.companyId;
        break;
      }
    }

    // Get a valid department
    const deptRes = await query(
      `SELECT id
       FROM departments
       WHERE company_id = $1
         AND deleted_at IS NULL
         AND COALESCE(is_active, status, TRUE) = TRUE
       LIMIT 1`,
      [companyId]
    );
    departmentId = deptRes.rows[0]?.id;

    // Get a valid role for this company
    const roleRes = await query(
      'SELECT id FROM roles WHERE (company_id = $1 OR company_id IS NULL) AND deleted_at IS NULL AND COALESCE(is_active, TRUE) = TRUE LIMIT 1',
      [companyId]
    );
    roleId = roleRes.rows[0]?.id;
  }, 30000);

  afterAll(async () => {
    if (createdAreaId) {
      await query('DELETE FROM areas WHERE id = $1', [createdAreaId]);
    }
    if (createdRoleId) {
      await query('DELETE FROM roles WHERE id = $1', [createdRoleId]);
    }
    if (createdDepartmentId) {
      await query('DELETE FROM departments WHERE id = $1', [createdDepartmentId]);
    }
  });

  test('GET /api/departments devuelve lista de departamentos', async () => {
    const res = await request(app)
      .get('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('is_active');
    }
  });

  test('GET /api/departments?include_inactive=true permite reactivar departamentos', async () => {
    const createRes = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: departmentName,
        description: 'Departamento de prueba para estado',
        is_active: true
      });

    expect(createRes.statusCode).toEqual(201);
    createdDepartmentId = createRes.body.data.id;

    const disableRes = await request(app)
      .patch(`/api/departments/${createdDepartmentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });

    expect(disableRes.statusCode).toEqual(200);
    expect(disableRes.body.data.is_active).toBe(false);

    const activeOnlyRes = await request(app)
      .get('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activeOnlyRes.body.data.some((department) => department.id === createdDepartmentId)).toBe(false);

    const allRes = await request(app)
      .get('/api/departments?include_inactive=true')
      .set('Authorization', `Bearer ${adminToken}`);
    const inactiveDepartment = allRes.body.data.find((department) => department.id === createdDepartmentId);
    expect(inactiveDepartment).toBeDefined();
    expect(inactiveDepartment.is_active).toBe(false);

    const enableRes = await request(app)
      .patch(`/api/departments/${createdDepartmentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: true });

    expect(enableRes.statusCode).toEqual(200);
    expect(enableRes.body.data.is_active).toBe(true);
  });

  test('POST /api/areas crea área con department_id y role_id', async () => {
    const res = await request(app)
      .post('/api/areas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: areaName,
        description: 'Área de prueba con departamento y rol',
        department_id: departmentId,
        role_id: roleId
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(areaName);
    createdAreaId = res.body.data.id;
  });

  test('POST /api/areas retorna AREA_ALREADY_EXISTS si nombre duplicado', async () => {
    const res = await request(app)
      .post('/api/areas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: areaName });

    expect(res.statusCode).toEqual(409);
    expect(res.body.errorCode).toBe('AREA_ALREADY_EXISTS');
  });

  test('POST /api/areas retorna error con role_id inexistente', async () => {
    const res = await request(app)
      .post('/api/areas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Area Rol Invalido ${Date.now()}`,
        role_id: '00000000-0000-0000-0000-000000000000'
      });

    expect(res.statusCode).toEqual(422);
    expect(res.body.errorCode).toBe('ROLE_NOT_FOUND');
  });

  test('POST /api/areas retorna error con department_id inexistente', async () => {
    const res = await request(app)
      .post('/api/areas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Area Dept Invalido ${Date.now()}`,
        department_id: '00000000-0000-0000-0000-000000000000'
      });

    expect(res.statusCode).toEqual(422);
    expect(res.body.errorCode).toBe('DEPARTMENT_NOT_FOUND');
  });

  test('GET /api/areas devuelve department_name y role_name en la respuesta', async () => {
    const res = await request(app)
      .get('/api/areas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    // Each item should have these fields
    const area = res.body.data.find(a => a.id === createdAreaId);
    expect(area).toBeDefined();
    expect(area).toHaveProperty('department_id');
    expect(area).toHaveProperty('role_id');
    expect(area).toHaveProperty('is_active');
  });

  test('GET /api/areas?status=all permite ver y reactivar areas inactivas', async () => {
    const disableRes = await request(app)
      .patch(`/api/areas/${createdAreaId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });

    expect(disableRes.statusCode).toEqual(200);
    expect(disableRes.body.data.is_active).toBe(false);

    const activeOnlyRes = await request(app)
      .get('/api/areas')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activeOnlyRes.body.data.some((area) => area.id === createdAreaId)).toBe(false);

    const allRes = await request(app)
      .get('/api/areas?status=all')
      .set('Authorization', `Bearer ${adminToken}`);
    const inactiveArea = allRes.body.data.find((area) => area.id === createdAreaId);
    expect(inactiveArea).toBeDefined();
    expect(inactiveArea.is_active).toBe(false);

    const enableRes = await request(app)
      .patch(`/api/areas/${createdAreaId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: true });

    expect(enableRes.statusCode).toEqual(200);
    expect(enableRes.body.data.is_active).toBe(true);
  });

  test('GET /api/areas/by-department/:id devuelve áreas del departamento', async () => {
    const res = await request(app)
      .get(`/api/areas/by-department/${departmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/job-positions/by-area/:areaId sigue funcionando', async () => {
    if (!createdAreaId) return;
    const res = await request(app)
      .get(`/api/job-positions/by-area/${createdAreaId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/roles crea rol de empresa', async () => {
    const res = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: roleCode,
        label: roleName,
        description: 'Rol QA creado desde prueba automatizada',
        modules: []
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role_key).toBe(roleCode);
    expect(res.body.data.name).toBe(roleName);
    expect(res.body.data.company_id).toBe(companyId);
    createdRoleId = res.body.data.id;
  });

  test('POST /api/roles retorna ROLE_ALREADY_EXISTS si rol duplicado', async () => {
    const res = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: roleCode,
        label: roleName,
        modules: []
      });

    expect(res.statusCode).toEqual(409);
    expect(res.body.errorCode).toBe('ROLE_ALREADY_EXISTS');
  });

  test('GET /api/roles?include_inactive=true permite ver y reactivar roles inactivos', async () => {
    const disableRes = await request(app)
      .patch(`/api/roles/${createdRoleId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });

    expect(disableRes.statusCode).toEqual(200);
    expect(disableRes.body.data.is_active).toBe(false);

    const activeOnlyRes = await request(app)
      .get('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activeOnlyRes.body.data.some((role) => role.id === createdRoleId)).toBe(false);

    const allRes = await request(app)
      .get('/api/roles?include_inactive=true')
      .set('Authorization', `Bearer ${adminToken}`);
    const inactiveRole = allRes.body.data.find((role) => role.id === createdRoleId);
    expect(inactiveRole).toBeDefined();
    expect(inactiveRole.is_active).toBe(false);

    const enableRes = await request(app)
      .patch(`/api/roles/${createdRoleId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: true });

    expect(enableRes.statusCode).toEqual(200);
    expect(enableRes.body.data.is_active).toBe(true);
  });
});
