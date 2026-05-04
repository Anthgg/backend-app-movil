require('dotenv').config();
const { Client } = require('pg');

const CLOUD_RUN_URL = 'https://backend-app-movil-177686674468.europe-west1.run.app';
const TEST_CREDENTIALS = {
  email: 'admin.qa@demo.com',
  password: 'AdminDemo2026!'
};

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Verificar que el usuario existe en BD
(async () => {
  try {
    console.log('📡 Verificando usuario en base de datos...');
    await client.connect();
    
    const result = await client.query(
      `SELECT u.id, u.email, u.is_active, u.status, r.name as role
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.email = $1`,
      [TEST_CREDENTIALS.email]
    );
    
    if (result.rows.length === 0) {
      console.error(`❌ Usuario ${TEST_CREDENTIALS.email} NO encontrado en BD`);
      process.exit(1);
    }
    
    console.log('✅ Usuario encontrado:', JSON.stringify(result.rows[0], null, 2));
    await client.end();
    
    // Proceder con pruebas HTTP
    await testCloudRunEndpoints();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();

async function testCloudRunEndpoints() {
  console.log(`\n🌐 Probando Cloud Run: ${CLOUD_RUN_URL}`);
  
  // 1. Test health
  console.log('\n📌 [1/11] GET /health/db');
  try {
    const res = await fetch(`${CLOUD_RUN_URL}/health/db`);
    const data = await res.json();
    console.log(`    Status: ${res.status} ${res.statusText}`);
    console.log(`    Respuesta: ${JSON.stringify(data).substring(0, 100)}`);
  } catch (e) {
    console.log(`    ❌ ERROR: ${e.message}`);
  }
  
  // 2. Login
  console.log('\n📌 [2/11] POST /api/login');
  let token = null;
  try {
    const res = await fetch(`${CLOUD_RUN_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_CREDENTIALS)
    });
    const data = await res.json();
    console.log(`    Status: ${res.status} ${res.statusText}`);
    
    // Intenta acceder de distintas formas
    const accessToken = data.accessToken || data.data?.accessToken;
    if (accessToken) {
      token = accessToken;
      console.log(`    Token: ${accessToken.substring(0, 25)}...`);
      const role = data.user?.role || data.data?.user?.role;
      console.log(`    User role: ${role || 'N/A'}`);
    } else {
      console.log(`    ❌ No se encontró accessToken en respuesta`);
    }
    console.log(`    Respuesta: ${JSON.stringify(data).substring(0, 150)}`);
  } catch (e) {
    console.log(`    ❌ ERROR: ${e.message}`);
  }
  
  if (!token) {
    console.error('\n❌ No se pudo obtener token. Abortando pruebas.');
    return;
  }
  
  // Endpoints protegidos
  const endpoints = [
    { method: 'GET', path: '/users' },
    { method: 'GET', path: '/workers' },
    { method: 'GET', path: '/attendance/today' },
    { method: 'GET', path: '/attendance/my-records' },
    { method: 'GET', path: '/devices/my' },
    { method: 'GET', path: '/dashboard/summary' },
    { method: 'GET', path: '/reports/attendance' },
    { method: 'GET', path: '/payroll/periods' },
    { method: 'GET', path: '/payroll' },
    { method: 'GET', path: '/routes' }
  ];
  
  let index = 3;
  for (const ep of endpoints) {
    console.log(`\n📌 [${index}/11] ${ep.method} ${ep.path}`);
    try {
      const res = await fetch(`${CLOUD_RUN_URL}${ep.path}`, {
        method: ep.method,
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      console.log(`    Status: ${res.status} ${res.statusText}`);
      const responseStr = JSON.stringify(data).substring(0, 120);
      console.log(`    Respuesta: ${responseStr}`);
      
      if (res.status !== 200) {
        console.log(`    ⚠️ Status inesperado: ${res.status}`);
      }
    } catch (e) {
      console.log(`    ❌ ERROR: ${e.message}`);
    }
    index++;
  }
  
  console.log('\n✅ ========== PRUEBAS COMPLETADAS ==========\n');
}
