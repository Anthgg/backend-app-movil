const request = require('supertest');
const app = require('../../src/app');

describe('API Health & Auth Tests', () => {

  let validToken = '';
  
  test('Endpoint /health/db funciona', async () => {
    const res = await request(app).get('/health/db');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
  });

  test('Login correcto con demo admin', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'admin@demo.com',
        password: 'Demo123!'
      });
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    validToken = res.body.data.accessToken;
  });

  test('Acceso a endpoint protegido con JWT válido', async () => {
    const res = await request(app)
      .get('/devices/my') // Endpoint protegido
      .set('Authorization', `Bearer ${validToken}`);
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });

  test('Acceso denegado con JWT inválido', async () => {
    const res = await request(app)
      .get('/devices/my')
      .set('Authorization', `Bearer invalid-token`);
      
    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
  });

});
