const request = require('supertest');
const app = require('../../src/app');

describe('Swagger Documentation API Tests', () => {

  test('GET /api-docs devuelve HTML de Swagger UI', async () => {
    // Es posible que tengamos un error 301 si usa el trailing slash. Testeamos la redireccion o el HTML.
    const res = await request(app).get('/api-docs/');
    
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Swagger UI');
  });

  test('GET /api-docs.json devuelve el objeto de Swagger', async () => {
    const res = await request(app).get('/api-docs.json');
    
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('openapi', '3.0.0');
    expect(res.body.info).toHaveProperty('title', 'HR Management Enterprise API');
    expect(res.body.paths).toHaveProperty('/auth/login');
    expect(res.body.components.securitySchemes).toHaveProperty('bearerAuth');
  });

});
