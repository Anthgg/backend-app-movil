const request = require('supertest');
const app = require('../src/app');
const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/database');

async function runPdfTests() {
  console.log('🧪 Iniciando pruebas de generación de PDFs Corporativos FABRYOR...');

  const outputDir = path.join(__dirname, '../test-outputs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  // 1. Iniciar sesión como ADMIN
  console.log('\n🔑 1. Autenticando administrador...');
  const loginRes = await request(app)
    .post('/api/login')
    .send({
      email: 'admin.corporativo@test.com',
      password: 'Demo1234!'
    });

  if (!loginRes.body || !loginRes.body.success) {
    console.error('❌ Error de autenticación:', loginRes.body);
    process.exit(1);
  }

  const token = loginRes.body.data.accessToken;
  const companyId = loginRes.body.data.user.companyId;
  console.log('✅ Autenticado con éxito. Company ID:', companyId);

  // 2. Insertar algunos registros de prueba en las tablas de planilla y asistencia para poblar el reporte
  console.log('\n📦 2. Asegurando existencia de datos de prueba en la base de datos...');

  // A. Obtener un periodo de planilla de prueba
  const periodRes = await query(`
    INSERT INTO payroll_periods (company_id, name, year, month, start_date, end_date, status)
    VALUES ($1, 'Mayo 2026', 2026, 5, '2026-05-01', '2026-05-31', 'draft')
    ON CONFLICT (company_id, year, month) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `, [companyId]);
  
  let periodId = periodRes.rows[0]?.id;
  if (!periodId) {
    const existingPeriod = await query('SELECT id FROM payroll_periods WHERE company_id = $1 LIMIT 1', [companyId]);
    periodId = existingPeriod.rows[0]?.id;
  }

  // B. Obtener un trabajador
  const workerRes = await query('SELECT id FROM workers WHERE company_id = $1 LIMIT 1', [companyId]);
  const workerId = workerRes.rows[0]?.id;

  if (workerId && periodId) {
    // C. Asegurar registro de planilla
    await query(`
      INSERT INTO payroll_records (company_id, payroll_period_id, worker_id, base_salary, deductions, net_estimated)
      VALUES ($1, $2, $3, 2500.00, 200.00, 2300.00)
      ON CONFLICT (payroll_period_id, worker_id) DO NOTHING
    `, [companyId, periodId, workerId]);
    console.log('✅ Registro de nómina/planilla insertado.');

    // D. Asegurar registro de asistencia
    await query(`
      INSERT INTO attendance_records (company_id, worker_id, date, check_in_time, check_out_time, status, late_minutes, worked_hours)
      VALUES ($1, $2, '2026-05-18', '2026-05-18 08:00:00', '2026-05-18 17:00:00', 'present', 0, 8)
      ON CONFLICT (worker_id, date) DO NOTHING
    `, [companyId, workerId]);
    console.log('✅ Registro de asistencia insertado.');
  }

  // 3. Probar Endpoints de PDF y guardarlos localmente
  const endpoints = [
    {
      name: 'Solicitudes',
      url: '/api/reports/requests/pdf',
      filename: 'reporte-solicitudes.pdf',
      body: { filters: { status: 'approved' } }
    },
    {
      name: 'Asistencia',
      url: '/api/reports/attendance/pdf',
      filename: 'reporte-asistencia.pdf',
      body: { filters: {} }
    },
    {
      name: 'Trabajadores',
      url: '/api/reports/workers/pdf',
      filename: 'reporte-trabajadores.pdf',
      body: { filters: { status: 'ACTIVE' } }
    },
    {
      name: 'Nómina/Planilla',
      url: '/api/reports/payroll/pdf',
      filename: 'reporte-planilla.pdf',
      body: { filters: {} }
    }
  ];

  for (const ep of endpoints) {
    console.log(`\n📄 Generando PDF corporativo de ${ep.name}...`);
    
    const start = Date.now();
    const response = await request(app)
      .post(ep.url)
      .set('Authorization', `Bearer ${token}`)
      .send(ep.body);

    const duration = Date.now() - start;

    console.log(`  Status Code: ${response.status}`);
    console.log(`  Content-Type: ${response.headers['content-type']}`);
    console.log(`  Duración: ${duration}ms`);

    if (response.status !== 200) {
      console.error(`❌ Falló la generación para ${ep.name}. Respuesta:`, response.body);
      process.exit(1);
    }

    const filePath = path.join(outputDir, ep.filename);
    fs.writeFileSync(filePath, response.body);
    
    const stats = fs.statSync(filePath);
    console.log(`  ✅ Guardado exitosamente en: ${filePath} (${(stats.size / 1024).toFixed(2)} KB)`);
  }

  console.log('\n✨ ¡TODOS LOS PDF CORPORATIVOS SE GENERARON CON ÉXITO Y PASARON LAS PRUEBAS! 🚀💯');
  process.exit(0);
}

runPdfTests().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
