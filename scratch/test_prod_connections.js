const axios = require('axios');

const cloudRunUrl = 'https://backend-app-movil-177686674468.europe-west1.run.app';

async function runTests() {
  console.log('================================================================');
  console.log(`🔍 INICIANDO PRUEBAS DE CONEXIÓN EN: ${cloudRunUrl}`);
  console.log('================================================================\n');

  // Test 1: Healthcheck General
  try {
    const res = await axios.get(`${cloudRunUrl}/health`);
    console.log(`✅ [${res.status}] General Health: OK -> service: "${res.data.service}"`);
  } catch (err) {
    console.error(`❌ General Health falló: ${err.message}`);
  }

  // Test 2: Conexión con Supabase Storage/API
  try {
    const res = await axios.get(`${cloudRunUrl}/health/supabase`);
    console.log(`✅ [${res.status}] Supabase Connection: OK -> status: "${res.data.status}"`);
  } catch (err) {
    console.error(`❌ Conexión a Supabase falló: ${err.message}`);
  }

  // Test 3: Conexión con base de datos PostgreSQL
  try {
    const res = await axios.get(`${cloudRunUrl}/health/db`);
    console.log(`✅ [${res.status}] PostgreSQL DB Connection: OK -> server_time: "${res.data.server_time}"`);
  } catch (err) {
    if (err.response) {
      console.error(`❌ PostgreSQL DB Connection: FALLÓ con estado [${err.response.status}] ->`, err.response.data);
    } else {
      console.error(`❌ PostgreSQL DB Connection: FALLÓ sin respuesta -> ${err.message}`);
    }
  }

  // Test 4: Endpoint de Documentación Protegido (Basic Auth)
  try {
    await axios.get(`${cloudRunUrl}/api-docs.json`);
    console.error('❌ Api Docs: Falló (Se esperaba 401 Unauthorized sin credenciales, pero respondió 200)');
  } catch (err) {
    if (err.response && err.response.status === 401) {
      console.log('✅ [401] Api Docs: OK -> Protegido con éxito (Basic Auth activo)');
    } else {
      console.error(`❌ Api Docs: Falló con estado inesperado -> ${err.message}`);
    }
  }

  // Test 5: Intentar inicio de sesión simulado
  try {
    const loginRes = await axios.post(`${cloudRunUrl}/api/auth/login`, {
      email: 'admin.qa@demo.com',
      password: 'wrong_password_test'
    });
    console.log(`⚠️ Login respondió inesperadamente con 200 para contraseña incorrecta:`, loginRes.data);
  } catch (err) {
    if (err.response && err.response.status === 401) {
      console.log('✅ [401] Login Endpoint: OK -> Rechazó credenciales inválidas como se esperaba');
    } else if (err.response) {
      console.error(`❌ Login Endpoint: Falló con estado [${err.response.status}] ->`, err.response.data);
    } else {
      console.error(`❌ Login Endpoint: Falló sin respuesta -> ${err.message}`);
    }
  }

  console.log('\n================================================================');
  console.log('🏁 FIN DE LAS PRUEBAS DE CONEXIÓN');
  console.log('================================================================');
}

runTests();
