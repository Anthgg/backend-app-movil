const request = require('supertest');
const app = require('../../src/app');
const { getAccessToken } = require('../helpers/auth.helper');
const { isStrongTemporaryPassword } = require('../../src/utils/password.util');

describe('POST /api/users/suggest-credentials', () => {
  let adminToken = '';
  let companyId = '';

  const VALID_PAYLOAD_SNAKE = {
    first_name: 'JESUS ANTHONY',
    paternal_last_name: 'GARAMENDI',
    maternal_last_name: 'GONZALES',
  };

  const VALID_PAYLOAD_CAMEL = {
    firstName: 'JESUS ANTHONY',
    paternalLastName: 'GARAMENDI',
    maternalLastName: 'GONZALES',
  };

  const loginWithFallback = async () => {
    const candidates = [
      { email: 'admin.qa@demo.com', password: 'AdminDemo2026!' },
      { email: 'admin@demo.com', password: 'Demo123!' },
    ];

    for (const candidate of candidates) {
      const res = await request(app).post('/auth/login').send(candidate);
      const token = getAccessToken(res.body);
      if (res.statusCode === 200 && token) {
        companyId = res.body.data.user.companyId;
        return token;
      }
    }

    throw new Error('No se pudo autenticar con usuario admin demo.');
  };

  beforeAll(async () => {
    adminToken = await loginWithFallback();
  }, 20000);

  // ------------------------------------------------------------------
  // 1. Campos base en la respuesta
  // ------------------------------------------------------------------
  test('1. Devuelve username en la respuesta', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.username).toBe('string');
    expect(res.body.data.username.length).toBeGreaterThan(0);
  });

  test('2. Devuelve corporateEmail en la respuesta', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.corporateEmail ?? res.body.data.corporate_email).toMatch(/@/);
  });

  // ------------------------------------------------------------------
  // 2. temporaryPassword presente y válido
  // ------------------------------------------------------------------
  test('3. Devuelve temporaryPassword en la respuesta', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    expect(res.statusCode).toBe(200);
    const pwd = res.body.data.temporaryPassword ?? res.body.data.temporary_password;
    expect(typeof pwd).toBe('string');
    expect(pwd.length).toBeGreaterThan(0);
  });

  test('4. temporaryPassword cumple la política de seguridad mínima', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    expect(res.statusCode).toBe(200);
    const pwd = res.body.data.temporaryPassword ?? res.body.data.temporary_password;

    expect(pwd.length).toBeGreaterThanOrEqual(8);
    expect(/[A-Z]/.test(pwd)).toBe(true);
    expect(/[a-z]/.test(pwd)).toBe(true);
    expect(/\d/.test(pwd)).toBe(true);
    expect(/[!@#$%&*\-_=+?]/.test(pwd)).toBe(true);

    // Validar con la función centralizada del util
    expect(isStrongTemporaryPassword(pwd)).toBe(true);
  });

  test('5. Devuelve forcePasswordChange: true', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    expect(res.statusCode).toBe(200);
    const flag =
      res.body.data.forcePasswordChange ?? res.body.data.force_password_change;
    expect(flag).toBe(true);
  });

  // ------------------------------------------------------------------
  // 3. Aleatoriedad — no debe repetirse en llamadas consecutivas
  // ------------------------------------------------------------------
  test('6. temporaryPassword no es igual en dos llamadas consecutivas', async () => {
    const call = () =>
      request(app)
        .post('/api/users/suggest-credentials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    const [res1, res2] = await Promise.all([call(), call()]);

    const pwd1 = res1.body.data.temporaryPassword ?? res1.body.data.temporary_password;
    const pwd2 = res2.body.data.temporaryPassword ?? res2.body.data.temporary_password;

    expect(pwd1).not.toEqual(pwd2);
  });

  // ------------------------------------------------------------------
  // 4. Compatibilidad de formatos de payload
  // ------------------------------------------------------------------
  test('7. No falla con payload en snake_case', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.temporaryPassword ?? res.body.data.temporary_password).toBeTruthy();
  });

  test('8. No falla con payload en camelCase', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_CAMEL, companyId });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.temporaryPassword ?? res.body.data.temporary_password).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // 5. Errores esperados
  // ------------------------------------------------------------------
  test('9. Error 422 si falta first_name', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paternal_last_name: 'GARAMENDI', company_id: companyId });

    expect(res.statusCode).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  test('10. Error 422 si falta paternal_last_name', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'JESUS', company_id: companyId });

    expect(res.statusCode).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  // ------------------------------------------------------------------
  // 6. Seguridad — la respuesta NO debe exponer passwords en otros campos
  // ------------------------------------------------------------------
  test('11. La respuesta NO contiene password en campos no esperados', async () => {
    const res = await request(app)
      .post('/api/users/suggest-credentials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...VALID_PAYLOAD_SNAKE, company_id: companyId });

    expect(res.statusCode).toBe(200);

    // Los campos relacionados con password permitidos son la clave temporal y el flag de cambio forzado.
    const allowedPasswordKeys = new Set([
      'temporaryPassword',
      'temporary_password',
      'forcePasswordChange',
      'force_password_change'
    ]);
    const dataKeys = Object.keys(res.body.data);

    const unexpectedPasswordKeys = dataKeys.filter(
      (k) => k.toLowerCase().includes('password') && !allowedPasswordKeys.has(k)
    );

    expect(unexpectedPasswordKeys).toHaveLength(0);
  });
});
