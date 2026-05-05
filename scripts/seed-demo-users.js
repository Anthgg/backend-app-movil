/**
 * Seed Demo Users - Versión adaptativa
 * 
 * Busca o crea datos demo. Si ya existen registros (por email, ruc, etc.),
 * los actualiza y usa sus IDs reales.
 * 
 * Uso: node scripts/seed-demo-users.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no definida. Configura .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const PASSWORD_HASH = '$2a$10$CsLE4X5hSG/iQxpEbjKFWuZuDIuadven1PUpnLFxc6BdZn269Ipz6'; // Demo1234!

async function upsertReturning(client, sql, params) {
  const r = await client.query(sql, params);
  return r.rows[0];
}

async function seed() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    console.log('🚀 Iniciando seed de usuarios demo...\n');

    // ═══ 1. EMPRESA ═══
    const company = await upsertReturning(client, `
      INSERT INTO companies (name, ruc, address, is_active)
      VALUES ('FABRYOR DEMO S.A.C.', '20999999999', 'Av. Demo 123, Lima, Perú', true)
      ON CONFLICT (ruc) DO UPDATE SET name = EXCLUDED.name, is_active = true
      RETURNING id
    `, []);
    const companyId = company.id;
    console.log('✅ Empresa:', companyId);

    // ═══ 2. DEPARTAMENTO ═══
    const dept = await upsertReturning(client, `
      INSERT INTO departments (name, description, company_id)
      VALUES ('Operaciones Demo', 'Departamento demo', $1)
      ON CONFLICT (name) DO UPDATE SET company_id = EXCLUDED.company_id
      RETURNING id
    `, [companyId]);
    const deptId = dept.id;
    console.log('✅ Departamento:', deptId);

    // ═══ 3. PUESTOS ═══
    let jobWorker = await client.query(`SELECT id FROM job_positions WHERE title = 'Operario Demo' LIMIT 1`);
    if (jobWorker.rows.length === 0) {
      jobWorker = await client.query(`
        INSERT INTO job_positions (title, department_id, base_salary, company_id)
        VALUES ('Operario Demo', $1, 1500.00, $2) RETURNING id
      `, [deptId, companyId]);
    }
    const jobWorkerId = jobWorker.rows[0].id;

    let jobRRHH = await client.query(`SELECT id FROM job_positions WHERE title = 'Analista RRHH Demo' LIMIT 1`);
    if (jobRRHH.rows.length === 0) {
      jobRRHH = await client.query(`
        INSERT INTO job_positions (title, department_id, base_salary, company_id)
        VALUES ('Analista RRHH Demo', $1, 3500.00, $2) RETURNING id
      `, [deptId, companyId]);
    }
    const jobRRHHId = jobRRHH.rows[0].id;
    console.log('✅ Puestos: Operario Demo, Analista RRHH Demo');

    // ═══ 4. PROYECTO ═══
    let project = await client.query(`SELECT id FROM projects WHERE name = 'Obra Demo Lima Centro' LIMIT 1`);
    if (project.rows.length === 0) {
      project = await client.query(`
        INSERT INTO projects (name, address, latitude, longitude, allowed_radius_meters, is_active, company_id)
        VALUES ('Obra Demo Lima Centro', 'Jr. Demo 456, Cercado de Lima', -12.046374, -77.042793, 500, true, $1)
        RETURNING id
      `, [companyId]);
    } else {
      await client.query(`UPDATE projects SET company_id = $1, is_active = true WHERE id = $2`, [companyId, project.rows[0].id]);
    }
    const projectId = project.rows[0].id;
    console.log('✅ Proyecto: Obra Demo Lima Centro (lat: -12.046, lng: -77.042, radio: 500m)');

    // ═══ 5. TURNO ═══
    let shift = await client.query(`SELECT id FROM shifts WHERE name = 'Turno Demo Diurno' LIMIT 1`);
    if (shift.rows.length === 0) {
      shift = await client.query(`
        INSERT INTO shifts (company_id, name, start_time, end_time, tolerance_minutes, working_days)
        VALUES ($1, 'Turno Demo Diurno', '08:00', '17:00', 15, '["Mon","Tue","Wed","Thu","Fri","Sat"]')
        RETURNING id
      `, [companyId]);
    }
    const shiftId = shift.rows[0].id;
    console.log('✅ Turno: Demo Diurno 08:00-17:00');

    // ═══ 6. USUARIO TRABAJADOR ═══
    const userW = await upsertReturning(client, `
      INSERT INTO users (email, password_hash, first_name, last_name, is_active, status, company_id)
      VALUES ('trabajador@demo.com', $1, 'Carlos', 'Demo Quispe', true, 'active', $2)
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        is_active = true, status = 'active',
        company_id = EXCLUDED.company_id,
        deleted_at = NULL
      RETURNING id
    `, [PASSWORD_HASH, companyId]);
    const userWorkerId = userW.id;
    console.log('✅ Usuario trabajador:', userWorkerId, '→ trabajador@demo.com / Demo1234!');

    // ═══ 7. USUARIO RRHH ═══
    const userR = await upsertReturning(client, `
      INSERT INTO users (email, password_hash, first_name, last_name, is_active, status, company_id)
      VALUES ('rrhh@demo.com', $1, 'María', 'Demo López', true, 'active', $2)
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        is_active = true, status = 'active',
        company_id = EXCLUDED.company_id,
        deleted_at = NULL
      RETURNING id
    `, [PASSWORD_HASH, companyId]);
    const userRRHHId = userR.id;
    console.log('✅ Usuario RRHH:', userRRHHId, '→ rrhh@demo.com / Demo1234!');

    // ═══ 8. ROLES ═══
    await client.query(`
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1, id FROM roles WHERE name = 'TRABAJADOR'
      ON CONFLICT DO NOTHING
    `, [userWorkerId]);

    await client.query(`
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1, id FROM roles WHERE name = 'RRHH'
      ON CONFLICT DO NOTHING
    `, [userRRHHId]);
    console.log('✅ Roles: TRABAJADOR → Carlos, RRHH → María');

    // ═══ 9. PERMISOS ═══
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.name = 'RRHH' AND p.name IN (
        'users.read','users.create','users.update',
        'workers.read','workers.create','workers.update',
        'dashboard.read','dashboard.admin',
        'attendance.read','attendance.correct',
        'shifts.read','shifts.create','shifts.update',
        'overtime.read','overtime.approve',
        'calendar.read','calendar.create',
        'MANAGE_USERS','MANAGE_WORKERS','VIEW_REPORTS','MANAGE_ATTENDANCE'
      ) ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.name = 'TRABAJADOR' AND p.name IN ('REGISTER_ATTENDANCE','dashboard.read')
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Permisos asignados');

    // ═══ 10. WORKERS ═══
    // Manejar ambos unique constraints: user_id y document_number
    let wWResult = await client.query(`SELECT id FROM workers WHERE user_id = $1`, [userWorkerId]);
    if (wWResult.rows.length > 0) {
      await client.query(`
        UPDATE workers SET document_type = 'DNI', document_number = '99000001', phone_number = '999111222',
          address = 'Calle Demo 100, Lima', job_position_id = $1, status = 'ACTIVE',
          company_id = $2, is_active = true, deleted_at = NULL
        WHERE user_id = $3
      `, [jobWorkerId, companyId, userWorkerId]);
    } else {
      wWResult = await client.query(`
        INSERT INTO workers (user_id, document_type, document_number, phone_number, address,
                            job_position_id, hire_date, status, company_id, is_active)
        VALUES ($1, 'DNI', '99000001', '999111222', 'Calle Demo 100, Lima', $2, '2025-01-15', 'ACTIVE', $3, true)
        ON CONFLICT (document_number) DO UPDATE SET user_id = EXCLUDED.user_id, company_id = EXCLUDED.company_id, is_active = true, deleted_at = NULL
        RETURNING id
      `, [userWorkerId, jobWorkerId, companyId]);
    }
    if (wWResult.rows.length === 0) wWResult = await client.query(`SELECT id FROM workers WHERE user_id = $1`, [userWorkerId]);
    const workerWId = wWResult.rows[0].id;

    let wRResult = await client.query(`SELECT id FROM workers WHERE user_id = $1`, [userRRHHId]);
    if (wRResult.rows.length > 0) {
      await client.query(`
        UPDATE workers SET document_type = 'DNI', document_number = '99000002', phone_number = '999333444',
          address = 'Av. Demo 200, Lima', job_position_id = $1, status = 'ACTIVE',
          company_id = $2, is_active = true, deleted_at = NULL
        WHERE user_id = $3
      `, [jobRRHHId, companyId, userRRHHId]);
    } else {
      wRResult = await client.query(`
        INSERT INTO workers (user_id, document_type, document_number, phone_number, address,
                            job_position_id, hire_date, status, company_id, is_active)
        VALUES ($1, 'DNI', '99000002', '999333444', 'Av. Demo 200, Lima', $2, '2024-06-01', 'ACTIVE', $3, true)
        ON CONFLICT (document_number) DO UPDATE SET user_id = EXCLUDED.user_id, company_id = EXCLUDED.company_id, is_active = true, deleted_at = NULL
        RETURNING id
      `, [userRRHHId, jobRRHHId, companyId]);
    }
    if (wRResult.rows.length === 0) wRResult = await client.query(`SELECT id FROM workers WHERE user_id = $1`, [userRRHHId]);
    const workerRId = wRResult.rows[0].id;
    console.log('✅ Workers: Carlos (DNI 99000001), María (DNI 99000002)');

    // ═══ 11. ASIGNAR A PROYECTO ═══
    await client.query(`
      INSERT INTO project_assignments (worker_id, project_id, assigned_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (worker_id, project_id) DO UPDATE SET unassigned_at = NULL
    `, [workerWId, projectId]);
    await client.query(`
      INSERT INTO project_assignments (worker_id, project_id, assigned_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (worker_id, project_id) DO UPDATE SET unassigned_at = NULL
    `, [workerRId, projectId]);
    console.log('✅ Asignados a proyecto: Obra Demo Lima Centro');

    // ═══ 12. ASIGNAR TURNO ═══
    await client.query(`
      INSERT INTO worker_shifts (worker_id, shift_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [workerWId, shiftId]);
    await client.query(`
      INSERT INTO worker_shifts (worker_id, shift_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [workerRId, shiftId]);
    console.log('✅ Turno asignado: Diurno 08:00-17:00');

    // ═══ 13. COMPANY SETTINGS ═══
    await client.query(`
      INSERT INTO company_settings (company_id, tardiness_tolerance_minutes, default_geolocation_radius,
                                    base_work_schedule, working_days)
      VALUES ($1, 15, 500, '{"start":"08:00","end":"17:00"}', '["Mon","Tue","Wed","Thu","Fri","Sat"]')
      ON CONFLICT (company_id) DO UPDATE SET
        tardiness_tolerance_minutes = EXCLUDED.tardiness_tolerance_minutes,
        default_geolocation_radius = EXCLUDED.default_geolocation_radius
    `, [companyId]);
    console.log('✅ Config empresa: tolerancia 15min, radio 500m');

    await client.query('COMMIT');

    console.log('\n════════════════════════════════════════════');
    console.log('  ✅ SEED COMPLETADO EXITOSAMENTE');
    console.log('════════════════════════════════════════════');
    console.log('');
    console.log('  👷 Trabajador:');
    console.log('     Email:    trabajador@demo.com');
    console.log('     Pass:     Demo1234!');
    console.log('     DNI:      99000001');
    console.log('     Rol:      TRABAJADOR');
    console.log('     User ID: ', userWorkerId);
    console.log('     Worker ID:', workerWId);
    console.log('');
    console.log('  👩‍💼 RRHH:');
    console.log('     Email:    rrhh@demo.com');
    console.log('     Pass:     Demo1234!');
    console.log('     DNI:      99000002');
    console.log('     Rol:      RRHH');
    console.log('     User ID: ', userRRHHId);
    console.log('     Worker ID:', workerRId);
    console.log('');
    console.log('  🏢 Empresa:  FABRYOR DEMO S.A.C. (', companyId, ')');
    console.log('  📍 Proyecto: Obra Demo Lima Centro (', projectId, ')');
    console.log('     Coords:   -12.046374, -77.042793');
    console.log('     Radio:    500m');
    console.log('  ⏰ Turno:    08:00-17:00 (Lun-Sáb)');
    console.log('════════════════════════════════════════════\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error en seed:', error.message);
    console.error(error.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
