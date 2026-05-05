const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

async function seed() {
  const companyId = 'bc331254-6afb-441a-bc87-2ea445a918fd'; // FABRYOR DEMO S.A.C.
  const passwordHash = await bcrypt.hash('Fabryor123!', 10);

  try {
    console.log('Seeding mobile users...');

    // 1. Worker
    const workerUser = await query(`
      INSERT INTO users (company_id, email, password_hash, first_name, last_name, is_active, status)
      VALUES ($1, $2, $3, $4, $5, true, 'active')
      ON CONFLICT (email) DO UPDATE SET password_hash = $3
      RETURNING id
    `, [companyId, 'trabajador@fabryor.com', passwordHash, 'Juan', 'Pérez']);

    const userId = workerUser.rows[0].id;
    
    // Asignar rol WORKER si existe la tabla user_roles
    // De lo contrario, saltar. Asumimos que el sistema usa roles por nombre en la tabla users o una relación.
    // Viendo el login, usa user_roles.
    
    const roleWorker = await query("SELECT id FROM roles WHERE name = 'WORKER'");
    if (roleWorker.rows[0]) {
      await query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, roleWorker.rows[0].id]);
    }

    await query(`
      INSERT INTO workers (user_id, company_id, document_type, document_number, phone_number, is_active, employment_status, hire_date)
      VALUES ($1, $2, $3, $4, $5, true, 'active', NOW())
      ON CONFLICT (user_id) DO NOTHING
    `, [userId, companyId, 'DNI', '99887766', '987654321']);

    // 2. RRHH
    const rrhhUser = await query(`
      INSERT INTO users (company_id, email, password_hash, first_name, last_name, is_active, status)
      VALUES ($1, $2, $3, $4, $5, true, 'active')
      ON CONFLICT (email) DO UPDATE SET password_hash = $3
      RETURNING id
    `, [companyId, 'rrhh@fabryor.com', passwordHash, 'María', 'RRHH']);
    
    const rrhhId = rrhhUser.rows[0].id;
    const roleRRHH = await query("SELECT id FROM roles WHERE name = 'RRHH'");
    if (roleRRHH.rows[0]) {
      await query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [rrhhId, roleRRHH.rows[0].id]);
    }

    console.log('Seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding users:', error);
    process.exit(1);
  }
}

seed();
