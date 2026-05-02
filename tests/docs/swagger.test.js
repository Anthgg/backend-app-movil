const request = require('supertest');
const app = require('../../src/app');

describe('Swagger Docs', () => {
  if (process.env.ENABLE_SWAGGER === 'true') {
    test('GET /api-docs/ should redirect to index.html', async () => {
      const response = await request(app).get('/api-docs/');
      // It should redirect to the swagger-ui-express html page
      expect(response.status).toBe(301);
      expect(response.headers.location).toBe('/api-docs/index.html');
    });

    test('GET /api-docs.json should return JSON content', async () => {
      const response = await request(app).get('/api-docs.json');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('Swagger JSON should contain securitySchemes', async () => {
      const response = await request(app).get('/api-docs.json');
      const spec = response.body;
      expect(spec.components).toHaveProperty('securitySchemes');
      expect(spec.components.securitySchemes).toHaveProperty('bearerAuth');
    });

    test('Swagger JSON should contain main tags', async () => {
      const response = await request(app).get('/api-docs.json');
      const spec = response.body;
      const tagNames = spec.tags.map(t => t.name);
      expect(tagNames).toContain('Auth');
      expect(tagNames).toContain('Attendance');
      expect(tagNames).toContain('Payroll');
    });

  } else {
    test('GET /api-docs should be disabled if ENABLE_SWAGGER is false', async () => {
      const response = await request(app).get('/api-docs');
      expect(response.status).toBe(404);
    });
  }
});
