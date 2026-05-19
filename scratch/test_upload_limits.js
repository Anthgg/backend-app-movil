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

  // 2. Upload with 4MB file (to test limit)
  console.log('\n--- Test 3MB limit (4MB file) ---');
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(7);
  let bodyHeader = `--${boundary}\r\n`;
  bodyHeader += `Content-Disposition: form-data; name="file"; filename="test.png"\r\n`;
  bodyHeader += `Content-Type: image/png\r\n\r\n`;
  let bodyFooter = `\r\n--${boundary}--\r\n`;
  
  // 4MB dummy file
  const largeFileContent = Buffer.alloc(4 * 1024 * 1024, 'a');
  const largeFinalBody = Buffer.concat([Buffer.from(bodyHeader), largeFileContent, Buffer.from(bodyFooter)]);

  const uploadLargeRes = await httpRequest('POST', `${BASE}/api/company-settings/logo`,
    { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': largeFinalBody.length
    },
    largeFinalBody
  );
  console.log('Status:', uploadLargeRes.status);
  console.log('Body:', uploadLargeRes.body);

  // 3. Upload with incorrect type
  console.log('\n--- Test incorrect type (PDF) ---');
  const pdfBodyHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
  const pdfFileContent = Buffer.from('PDF_FAKE_CONTENT');
  const pdfFinalBody = Buffer.concat([Buffer.from(pdfBodyHeader), pdfFileContent, Buffer.from(bodyFooter)]);

  const uploadPdfRes = await httpRequest('POST', `${BASE}/api/company-settings/logo`,
    { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': pdfFinalBody.length
    },
    pdfFinalBody
  );
  console.log('Status:', uploadPdfRes.status);
  console.log('Body:', uploadPdfRes.body);

  // 4. Test normal delete
  console.log('\n--- Test Delete Logo ---');
  const deleteRes = await httpRequest('DELETE', `${BASE}/api/company-settings/logo`, { 'Authorization': `Bearer ${token}` });
  console.log('Status:', deleteRes.status);
  console.log('Body:', deleteRes.body);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
