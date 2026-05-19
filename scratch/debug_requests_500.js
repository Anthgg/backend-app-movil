const https = require('https');

const BASE = 'https://backend-app-movil-177686674468.europe-west1.run.app';

async function fetchJSON(method, path, token, body) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      path: url.pathname,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  // Login
  const login = await fetchJSON('POST', '/api/login', '', { email: 'admin.qa@demo.com', password: 'AdminDemo2026!' });
  if (!login.body.success) { console.error('Login failed:', login.body); process.exit(1); }
  const token = login.body.data.accessToken;
  console.log('Login OK');

  // Crear solicitud
  const create = await fetchJSON('POST', '/api/requests', token, {
    requestTypeId: 'aad6e9d2-38d3-46ae-9ef4-b8cf68c86f52',
    startDate: '2028-01-15', endDate: '2028-01-16',
    reason: 'Debug test 500'
  });
  console.log('\nCrear:', create.status, JSON.stringify(create.body).substring(0, 200));

  if (!create.body.success) { process.exit(1); }
  const reqId = create.body.data.request.id;

  // Detalle (este da 500)
  const detail = await fetchJSON('GET', `/api/requests/${reqId}`, token);
  console.log('\nDetalle:', detail.status);
  console.log(JSON.stringify(detail.body, null, 2).substring(0, 500));

  // Listar documentos (este da 500)  
  const docs = await fetchJSON('GET', `/api/requests/${reqId}/documents`, token);
  console.log('\nDocumentos:', docs.status);
  console.log(JSON.stringify(docs.body, null, 2).substring(0, 500));

  process.exit(0);
})();
