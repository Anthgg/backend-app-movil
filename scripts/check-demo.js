require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const r = await p.query("SELECT id, email, company_id FROM users WHERE email IN ('trabajador@demo.com','rrhh@demo.com')");
  console.log('Users found:', JSON.stringify(r.rows, null, 2));
  
  const roles = await p.query("SELECT id, name FROM roles");
  console.log('Roles:', JSON.stringify(roles.rows, null, 2));
  
  await p.end();
}
check().catch(e => { console.error(e.message); p.end(); });
