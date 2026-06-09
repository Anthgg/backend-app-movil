const request = require('supertest');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../../src/config/database');

function getAccessToken(body) {
  return body?.data?.accessToken
    || body?.data?.token
    || body?.accessToken
    || body?.token;
}

async function loginAs(app, email, password) {
  const response = await request(app)
    .post('/auth/login')
    .send({ email, password });

  const token = getAccessToken(response.body);
  return { response, token };
}

async function loginAsAdmin(app) {
  const { response, token } = await loginAs(app, 'admin@demo.com', 'Demo123!');
  expect(response.statusCode).toBe(200);
  expect(token).toBeDefined();
  return token;
}

async function ensureDemoWorkerUser() {
  const passwordHash = await bcrypt.hash('Demo123!', 10);

  await withTransaction(async (client) => {
    const companyRes = await client.query(
      `SELECT company_id
       FROM users
       WHERE email = 'admin@demo.com'
         AND deleted_at IS NULL
       LIMIT 1`
    );
    const companyId = companyRes.rows[0]?.company_id;
    if (!companyId) {
      throw new Error('No se encontro company_id de admin@demo.com para preparar usuario trabajador de prueba.');
    }

    const roleRes = await client.query(
      `SELECT id
       FROM roles
       WHERE deleted_at IS NULL
         AND COALESCE(is_active, TRUE) = TRUE
         AND (code = 'TRABAJADOR' OR name = 'TRABAJADOR' OR name = 'Trabajador')
       ORDER BY CASE WHEN company_id = $1 THEN 0 ELSE 1 END, company_id NULLS LAST
       LIMIT 1`,
      [companyId]
    );
    const roleId = roleRes.rows[0]?.id;
    if (!roleId) {
      throw new Error('No se encontro rol TRABAJADOR para preparar usuario trabajador de prueba.');
    }

    const userRes = await client.query(
      `INSERT INTO users (company_id, email, username, password_hash, first_name, last_name, full_name, is_active, status, force_password_change)
       VALUES ($1, 'trabajador@demo.com', 'trabajador.demo', $2, 'Trabajador', 'Demo', 'Trabajador Demo', TRUE, 'active', FALSE)
       ON CONFLICT (email) DO UPDATE
       SET company_id = EXCLUDED.company_id,
           username = EXCLUDED.username,
           password_hash = EXCLUDED.password_hash,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           full_name = EXCLUDED.full_name,
           is_active = TRUE,
           status = 'active',
           deleted_at = NULL,
           force_password_change = FALSE
       RETURNING id`,
      [companyId, passwordHash]
    );
    const userId = userRes.rows[0].id;

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, roleId]
    );

    const existingWorker = await client.query(
      `SELECT id FROM workers WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (existingWorker.rowCount > 0) {
      await client.query(
        `UPDATE workers
         SET company_id = $1,
             document_type = 'DNI',
             document_number = COALESCE(document_number, '70000001'),
             first_name = 'Trabajador',
             paternal_last_name = 'Demo',
             is_active = TRUE,
             employment_status = 'active',
             status = 'ACTIVE',
             deleted_at = NULL,
             hire_date = COALESCE(hire_date, CURRENT_DATE)
         WHERE id = $2`,
        [companyId, existingWorker.rows[0].id]
      );
    } else {
      let documentNumber = '70000001';
      const docExists = await client.query(
        `SELECT 1 FROM workers WHERE document_number = $1 LIMIT 1`,
        [documentNumber]
      );
      if (docExists.rowCount > 0) {
        documentNumber = String(70000000 + Math.floor(Math.random() * 999999)).padStart(8, '0');
      }

      await client.query(
        `INSERT INTO workers (user_id, company_id, document_type, document_number, first_name, paternal_last_name, is_active, employment_status, hire_date, status)
         VALUES ($1, $2, 'DNI', $3, 'Trabajador', 'Demo', TRUE, 'active', CURRENT_DATE, 'ACTIVE')`,
        [userId, companyId, documentNumber]
      );
    }
  });
}

async function loginAsTrabajador(app) {
  await ensureDemoWorkerUser();
  const { response, token } = await loginAs(app, 'trabajador@demo.com', 'Demo123!');
  expect(response.statusCode).toBe(200);
  expect(token).toBeDefined();
  return token;
}

async function getQaAuthToken(app, email = 'admin@demo.com', password = 'Demo123!') {
  if (email === 'trabajador@demo.com') {
    await ensureDemoWorkerUser();
  }
  const { response, token } = await loginAs(app, email, password);
  expect(response.statusCode).toBe(200);
  expect(token).toBeDefined();
  return token;
}

module.exports = {
  getAccessToken,
  loginAs,
  loginAsAdmin,
  loginAsTrabajador,
  ensureDemoWorkerUser,
  getQaAuthToken
};

