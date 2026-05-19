const https = require('https');
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
    
    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
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

  // 2. Crear solicitud
  const randomDays = Math.floor(Math.random() * 300) + 200;
  const startDate = new Date(Date.now() + randomDays * 86400000).toISOString().split('T')[0];
  const endDate = new Date(Date.now() + (randomDays + 1) * 86400000).toISOString().split('T')[0];

  const createRes = await httpRequest('POST', `${BASE}/api/requests`,
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    JSON.stringify({ requestTypeId: 'aad6e9d2-38d3-46ae-9ef4-b8cf68c86f52', startDate, endDate, reason: 'Debug upload test' })
  );
  const createData = JSON.parse(createRes.body);
  if (!createData.success) {
    console.error('Error creando solicitud:', createData);
    process.exit(1);
  }
  const reqId = createData.data.request.id;
  console.log('Solicitud creada:', reqId);

  // 3. Upload con multipart real
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(7);
  const fileContent = 'Este es un archivo de prueba para upload QA';
  
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="documents"; filename="test-qa.txt"\r\n`;
  body += `Content-Type: text/plain\r\n\r\n`;
  body += `${fileContent}\r\n`;
  body += `--${boundary}--\r\n`;

  console.log('\nUpload request...');
  console.log('URL:', `${BASE}/api/requests/${reqId}/documents`);
  console.log('Content-Type:', `multipart/form-data; boundary=${boundary}`);
  console.log('Body length:', body.length);

  const uploadRes = await httpRequest('POST', `${BASE}/api/requests/${reqId}/documents`,
    { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(body)
    },
    body
  );

  console.log('\nUpload Response:');
  console.log('Status:', uploadRes.status);
  console.log('Body:', uploadRes.body.substring(0, 1000));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
