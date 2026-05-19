const http = require('http');

const BASE = 'http://localhost:8080';

function httpRequest(method, urlStr, headers = {}, body = null) {
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
  try {
    // 1. Login
    const loginRes = await httpRequest('POST', `${BASE}/api/login`, 
      { 'Content-Type': 'application/json' },
      JSON.stringify({ email: 'admin.qa@demo.com', password: 'AdminDemo2026!' })
    );
    const token = JSON.parse(loginRes.body).data.accessToken;

    console.log('--- PRUEBAS OBLIGATORIAS ---');

    // 1. GET /api/company-settings
    const getRes = await httpRequest('GET', `${BASE}/api/company-settings`, { 'Authorization': `Bearer ${token}` });
    console.log(`\n1. GET /api/company-settings -> Status: ${getRes.status}`);

    // 2. PUT /api/company-settings
    const putRes = await httpRequest('PUT', `${BASE}/api/company-settings`, 
      { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      JSON.stringify({
        razon_social: "FABRYOR", ruc: "20600000000", color_texto: "#0F172A"
      })
    );
    console.log(`2. PUT /api/company-settings -> Status: ${putRes.status}`);

    // Crear un mock form-data
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(7);
    const createMultipart = (filename, isLarge = false, isInvalidFormat = false) => {
      let bodyHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
      bodyHeader += `Content-Type: ${isInvalidFormat ? 'application/pdf' : 'image/png'}\r\n\r\n`;
      const bodyFooter = `\r\n--${boundary}--\r\n`;
      
      const contentSize = isLarge ? 4 * 1024 * 1024 : 1024; // 4MB or 1KB
      const fileContent = Buffer.alloc(contentSize, 'a');
      return Buffer.concat([Buffer.from(bodyHeader), fileContent, Buffer.from(bodyFooter)]);
    };

    const headers = { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    };

    // 3. POST logo
    const payloadLogo = createMultipart('logo.png');
    headers['Content-Length'] = payloadLogo.length;
    const postLogo = await httpRequest('POST', `${BASE}/api/company-settings/logo`, headers, payloadLogo);
    console.log(`3. POST /api/company-settings/logo -> Status: ${postLogo.status}`);

    // 4. POST signature
    const payloadSig = createMultipart('firma.png');
    headers['Content-Length'] = payloadSig.length;
    const postSig = await httpRequest('POST', `${BASE}/api/company-settings/signature`, headers, payloadSig);
    console.log(`4. POST /api/company-settings/signature -> Status: ${postSig.status}`);

    // 5. POST stamp
    const payloadStamp = createMultipart('sello.png');
    headers['Content-Length'] = payloadStamp.length;
    const postStamp = await httpRequest('POST', `${BASE}/api/company-settings/stamp`, headers, payloadStamp);
    console.log(`5. POST /api/company-settings/stamp -> Status: ${postStamp.status}`);

    // 6, 7, 8. DELETE endpoints
    const delLogo = await httpRequest('DELETE', `${BASE}/api/company-settings/logo`, { 'Authorization': `Bearer ${token}` });
    console.log(`6. DELETE /api/company-settings/logo -> Status: ${delLogo.status}`);
    
    const delSig = await httpRequest('DELETE', `${BASE}/api/company-settings/signature`, { 'Authorization': `Bearer ${token}` });
    console.log(`7. DELETE /api/company-settings/signature -> Status: ${delSig.status}`);
    
    const delStamp = await httpRequest('DELETE', `${BASE}/api/company-settings/stamp`, { 'Authorization': `Bearer ${token}` });
    console.log(`8. DELETE /api/company-settings/stamp -> Status: ${delStamp.status}`);

    // 9. Límite de 3MB
    const payloadLarge = createMultipart('large.png', true);
    headers['Content-Length'] = payloadLarge.length;
    const postLarge = await httpRequest('POST', `${BASE}/api/company-settings/logo`, headers, payloadLarge);
    console.log(`\n9. Límite de 3MB -> Status: ${postLarge.status} | Body: ${postLarge.body}`);

    // 10. Validación de formato
    const payloadInvalid = createMultipart('test.pdf', false, true);
    headers['Content-Length'] = payloadInvalid.length;
    const postInvalid = await httpRequest('POST', `${BASE}/api/company-settings/logo`, headers, payloadInvalid);
    console.log(`10. Formato inválido -> Status: ${postInvalid.status} | Body: ${postInvalid.body}`);

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
