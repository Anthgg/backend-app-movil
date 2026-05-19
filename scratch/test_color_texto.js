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

  // 2. PUT Update with text_color
  console.log('\nPUT /api/company-settings (Valid)...');
  const putRes = await httpRequest('PUT', `${BASE}/api/company-settings`, 
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    JSON.stringify({
      razon_social: "FABRYOR SERVICIOS GENERALES S.A.C.",
      ruc: "20605153136",
      nombre_comercial: "FABRYOR",
      color_texto: "#111827"
    })
  );
  console.log('Status:', putRes.status);
  console.log('Body:', putRes.body);

  // 3. PUT Invalid format
  console.log('\nPUT /api/company-settings (Invalid color_texto)...');
  const putInvalidRes = await httpRequest('PUT', `${BASE}/api/company-settings`, 
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    JSON.stringify({
      razon_social: "FABRYOR",
      ruc: "20605153136",
      color_texto: "invalid-color"
    })
  );
  console.log('Status:', putInvalidRes.status);
  console.log('Body:', putInvalidRes.body);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
