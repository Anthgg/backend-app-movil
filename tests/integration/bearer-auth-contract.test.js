const express = require('express');
const request = require('supertest');
const { authenticateToken } = require('../../src/shared/middlewares/auth.middleware');

function buildApp() {
  const app = express();
  app.get('/protected', authenticateToken, (req, res) => res.json({ ok: true }));
  return app;
}

describe('Bearer authentication contract', () => {
  const app = buildApp();

  test.each([
    {},
    { Authorization: 'Basic abc123' },
    { Authorization: 'Token abc123' },
    { Authorization: 'Bearer' },
    { Authorization: 'Bearer token with-spaces' }
  ])('rechaza una cabecera que no sea Bearer válida: %j', async (headers) => {
    const response = await request(app).get('/protected').set(headers);

    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: 'BEARER_TOKEN_REQUIRED'
    });
  });
});
