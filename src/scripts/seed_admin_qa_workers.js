const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

async function seed() {
  const companyId = 'c487e654-6827-4dc8-8690-baed056bcd5e'; // Empresa Demo S.A.C.
  const projectId = '59f21f41-9f4b-497f-b396-0da6435b4ff3'; // Demo Mobile HQ
  const passwordHash = await bcrypt.hash('Fabryor123!', 10);

  const workers = [
    { email: 'trabajador1.qa@demo.com', first: 'Carlos', last: 'Ruiz', dni: '77665544' },
    { email: 'trabajador2.qa@demo.com', first: 'Ana', last: 'Torres', dni: '77665545' },
    { email: 'trabajador3.qa@demo.com', first: 'Roberto', last: 'Gomez', dni: '77665546' }
  ];

  try {
    console.log('Seeding demo workers for Admin QA...');

    const roleWorker = await query("SELECT id FROM roles WHERE name = 'WORKER'");
    const roleId = roleWorker.rows[0]?.id;

    for (const w of workers) {
      // 1. User
      const userRes = await query(`
        INSERT INTO users (company_id, email, password_hash, first_name, last_name, is_active, status)
        VALUES ($1, $2, $3, $4, $5, true, 'active')
        ON CONFLICT (email) DO UPDATE SET password_hash = $3
        RETURNING id
      `, [companyId, w.email, passwordHash, w.first, w.last]);

      const userId = userRes.rows[0].id;

      // 2. Role
      if (roleId) {
        await query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, roleId]);
      }

      // 3. Worker
      const workerRes = await query(`
        INSERT INTO workers (user_id, company_id, document_type, document_number, phone_number, is_active, employment_status, hire_date)
        VALUES ($1, $2, 'DNI', $3, $4, true, 'active', NOW())
        ON CONFLICT (user_id) DO UPDATE SET document_number = $3
        RETURNING id
      `, [userId, companyId, w.dni, '911223344']);
      
      const workerId = workerRes.rows[0].id;

      // 4. Project Assignment
      await query(`
        INSERT INTO project_assignments (worker_id, project_id, assigned_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (worker_id, project_id) DO NOTHING
      `, [workerId, projectId]);
      
      console.log(`- Created worker: ${w.email}`);
    }

    console.log('Seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding demo workers:', error);
    process.exit(1);
  }
}

seed();
