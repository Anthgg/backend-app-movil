/**
 * Script para insertar datos de prueba: Admin, RRHH y Trabajador en la misma empresa.
 */
require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const PASSWORD_HASH = '$2a$10$CsLE4X5hSG/iQxpEbjKFWuZuDIuadven1PUpnLFxc6BdZn269Ipz6'; // Demo1234!

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🚀 Iniciando inserción de datos de prueba...');

    // 1. Crear Empresa
    const companyRes = await client.query(`
      INSERT INTO companies (name, ruc, address, is_active)
      VALUES ('Empresa Corporativa S.A.', '20888777666', 'Av. Empresarial 456, Lima', true)
      ON CONFLICT (ruc) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    const companyId = companyRes.rows[0].id;
    console.log('✅ Empresa creada:', companyId);

    // 2. Obtener IDs de Roles
    const rolesRes = await client.query('SELECT id, name FROM roles');
    const roles = rolesRes.rows.reduce((acc, r) => ({ ...acc, [r.name]: r.id }), {});

    // 3. Crear Usuarios
    const usersData = [
      { email: 'admin.corporativo@test.com', first_name: 'Admin', last_name: 'Principal', role: 'ADMIN' },
      { email: 'rrhh.corporativo@test.com', first_name: 'Ana', last_name: 'Recursos', role: 'RRHH' },
      { email: 'trabajador.corporativo@test.com', first_name: 'Pedro', last_name: 'Operativo', role: 'TRABAJADOR' }
    ];

    const userIds = {};

    for (const u of usersData) {
      const userRes = await client.query(`
        INSERT INTO users (email, password_hash, first_name, last_name, company_id, is_active, status)
        VALUES ($1, $2, $3, $4, $5, true, 'active')
        ON CONFLICT (email) DO UPDATE SET company_id = EXCLUDED.company_id, status = 'active', is_active = true
        RETURNING id
      `, [u.email, PASSWORD_HASH, u.first_name, u.last_name, companyId]);
      
      const userId = userRes.rows[0].id;
      userIds[u.role] = userId;

      await client.query(`
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [userId, roles[u.role]]);
      
      console.log(`✅ Usuario ${u.role} creado: ${u.email}`);
    }

    // 4. Crear Perfil de Trabajador
    await client.query(`
      INSERT INTO workers (user_id, company_id, document_type, document_number, phone_number, address, hire_date, status)
      VALUES ($1, $2, 'DNI', '88776655', '988777666', 'Calle del Sol 123', '2026-01-01', 'ACTIVE')
      ON CONFLICT (document_number) DO UPDATE SET user_id = EXCLUDED.user_id, company_id = EXCLUDED.company_id
    `, [userIds['TRABAJADOR'], companyId]);
    console.log('✅ Perfil de trabajador creado para Pedro');

    await client.query('COMMIT');
    console.log('\n✨ Inserción completada con éxito en Supabase.');
    console.log('----------------------------------------------');
    console.log('Empresa: Empresa Corporativa S.A.');
    console.log('Password para todos: Demo1234!');
    console.log('Admin: admin.corporativo@test.com');
    console.log('RRHH:  rrhh.corporativo@test.com');
    console.log('Worker: trabajador.corporativo@test.com');
    console.log('----------------------------------------------');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al insertar datos:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
