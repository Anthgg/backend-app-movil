const http = require('http');
const https = require('https');

const cloudRunUrl = process.env.CLOUD_RUN_URL;
if (!cloudRunUrl) {
  console.error('❌ Provee la URL de Cloud Run en la variable CLOUD_RUN_URL.');
  process.exit(1);
}

const client = cloudRunUrl.startsWith('https') ? https : http;
const urlPrefix = cloudRunUrl.replace(/\/$/, '');

const checkEndpoint = (endpoint, expectedStatus = 200, isPost = false) => {
  return new Promise((resolve) => {
    const options = {
      method: isPost ? 'POST' : 'GET',
    };
    const req = client.request(`${urlPrefix}${endpoint}`, options, (res) => {
      if (res.statusCode === expectedStatus) {
        console.log(`✅ [${res.statusCode}] ${endpoint}`);
        resolve(true);
      } else {
        console.error(`❌ [${res.statusCode}] ${endpoint} (Esperaba ${expectedStatus})`);
        resolve(false);
      }
    });
    req.on('error', (e) => {
      console.error(`❌ Error al conectar a ${endpoint}: ${e.message}`);
      resolve(false);
    });
    if (isPost) {
      req.write(JSON.stringify({}));
    }
    req.end();
  });
};

const checkLogin = async () => {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ email: 'admin@demo.com', password: 'Demo123!' });
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = client.request(`${urlPrefix}/auth/login`, options, (res) => {
      if (res.statusCode === 200 || res.statusCode === 401 || res.statusCode === 404) {
        console.log(`✅ [${res.statusCode}] /auth/login respondió con estado esperado`);
        resolve(true);
      } else {
        console.error(`❌ [${res.statusCode}] /auth/login (Status inesperado)`);
        resolve(false);
      }
    });
    req.on('error', (e) => {
      console.error(`❌ Error al conectar a /auth/login: ${e.message}`);
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
};

const runChecks = async () => {
  console.log(`Verificando despliegue en: ${urlPrefix}\n`);
  
  let allGood = true;

  allGood = await checkEndpoint('/health', 200) && allGood;
  allGood = await checkEndpoint('/health/db', 200) && allGood;
  allGood = await checkEndpoint('/health/supabase', 200) && allGood;
  
  // Api docs debe estar protegido y responder 401 sin credenciales
  allGood = await checkEndpoint('/api-docs.json', 401) && allGood;
  
  // Login debe responder
  allGood = await checkLogin() && allGood;

  if (allGood) {
    console.log('\n🚀 Verificación completada con éxito. El backend de Cloud Run está saludable.');
  } else {
    console.log('\n⚠️ Hubo fallos en la verificación.');
  }
};

runChecks();
