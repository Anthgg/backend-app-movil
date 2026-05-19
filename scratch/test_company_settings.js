const http = require('http');

const BASE = 'http://localhost:8080';

function httpRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers }
    };
    
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  // 1. Login
  const loginRes = await httpRequest('POST', `${BASE}/api/login`, 
    { 'Content-Type': 'application/json' },
    JSON.stringify({ email: 'admin.qa@demo.com', password: 'AdminDemo2026!' })
  );
  const loginData = JSON.parse(loginRes.body);
  const token = loginData.data.accessToken;
  console.log('Login OK');

  // 2. Obtener config actual
  console.log('\nGET /api/company-settings...');
  const getRes1 = await httpRequest('GET', `${BASE}/api/company-settings`, { 'Authorization': `Bearer ${token}` });
  console.log('Status:', getRes1.status);
  console.log('Body:', getRes1.body);

  // 3. Crear config (UPSERT)
  console.log('\nPUT /api/company-settings...');
  const putPayload = {
    razon_social: "EMPRESA DE PRUEBA S.A.C.",
    nombre_comercial: "PRUEBA",
    ruc: "20123456789",
    direccion_fiscal: "Av. Falsa 123",
    telefono: "+51 999 888 777",
    correo_corporativo: "contacto@empresa.com",
    pagina_web: "https://empresa.com",
    representante_legal: "Juan Perez",
    color_primario: "#FF0000",
    color_secundario: "#00FF00"
  };
  const putRes = await httpRequest('PUT', `${BASE}/api/company-settings`, 
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    JSON.stringify(putPayload)
  );
  console.log('Status:', putRes.status);
  console.log('Body:', putRes.body);

  // 4. Subir logo
  console.log('\nPOST /api/company-settings/logo...');
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(7);
  
  // Fake tiny PNG
  const fileContent = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  
  let bodyHeader = `--${boundary}\r\n`;
  bodyHeader += `Content-Disposition: form-data; name="file"; filename="test-logo.png"\r\n`;
  bodyHeader += `Content-Type: image/png\r\n\r\n`;
  
  let bodyFooter = `\r\n--${boundary}--\r\n`;

  const finalBody = Buffer.concat([Buffer.from(bodyHeader), fileContent, Buffer.from(bodyFooter)]);

  const uploadRes = await httpRequest('POST', `${BASE}/api/company-settings/logo`,
    { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': finalBody.length
    },
    finalBody
  );
  console.log('Status:', uploadRes.status);
  console.log('Body:', uploadRes.body);

  // 5. Test PDF Endpoint corporativo
  console.log('\nPOST /api/reports/requests/pdf...');
  const pdfRes = await httpRequest('POST', `${BASE}/api/reports/requests/pdf`, 
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    JSON.stringify({})
  );
  console.log('PDF Status:', pdfRes.status);
  console.log('PDF Body Length:', pdfRes.body.length);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
