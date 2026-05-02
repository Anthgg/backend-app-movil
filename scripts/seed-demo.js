const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seedDemoData() {
  try {
    console.log('Iniciando carga de datos Demo...');
    await pool.query('BEGIN');

    // 1. Crear Empresa Demo
    const companyRes = await pool.query(`
      INSERT INTO companies (name, ruc, address) 
      VALUES ('Empresa Demo S.A.C.', '20123456789', 'Av. Principal 123, Lima')
      RETURNING id
    `);
    const companyId = companyRes.rows[0].id;

    // 2. Hash de contraseña genérica "Demo123!"
    const passwordHash = await bcrypt.hash('Demo123!', 10);

    // 3. Crear Usuarios Demo
    const usersData = [
      { email: 'admin@demo.com', fname: 'Admin', lname: 'Demo', role: 'ADMIN' },
      { email: 'rrhh@demo.com', fname: 'RRHH', lname: 'Demo', role: 'RRHH' },
      { email: 'supervisor@demo.com', fname: 'Supervisor', lname: 'Demo', role: 'SUPERVISOR' },
      { email: 'trabajador@demo.com', fname: 'Trabajador', lname: 'Demo', role: 'TRABAJADOR' }
    ];

    for (const u of usersData) {
      // Insert User
      const uRes = await pool.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, company_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `, [u.email, passwordHash, u.fname, u.lname, companyId]);
      
      const userId = uRes.rows[0]?.id;
      if (!userId) continue;

      // Assign Role
      const roleRes = await pool.query(`SELECT id FROM roles WHERE name = $1`, [u.role]);
      if (roleRes.rows.length > 0) {
        await pool.query(`
          INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
        `, [userId, roleRes.rows[0].id]);
      }

      // If worker, insert into workers
      if (u.role === 'TRABAJADOR') {
        await pool.query(`
          INSERT INTO workers (user_id, company_id, document_type, document_number, hire_date)
          VALUES ($1, $2, 'DNI', '00000000', NOW())
          ON CONFLICT (document_number) DO NOTHING
        `, [userId, companyId]);
      }
    }

    // 4. Crear Proyecto de prueba
    await pool.query(`
      INSERT INTO projects (name, address, latitude, longitude, company_id)
      VALUES ('Proyecto Alpha', 'Obra Central Lima', -12.046374, -77.042793, $1)
    `, [companyId]);

    await pool.query('COMMIT');
    console.log('✅ Datos Demo insertados correctamente.');
    console.log('Usuarios generados: admin@demo.com, rrhh@demo.com, supervisor@demo.com, trabajador@demo.com');
    console.log('Contraseña para todos: Demo123!');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('❌ Error en seed:', error);
  } finally {
    await pool.end();
  }
}

seedDemoData();
