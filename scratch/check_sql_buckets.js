require('dotenv').config({ path: '.env.production.local' });
const { query } = require('../src/config/database');

(async () => {
  try {
    console.log('Consultando storage.buckets directamente por SQL...');
    const res = await query('SELECT id, name, public FROM storage.buckets');
    console.log('Buckets en base de datos:');
    res.rows.forEach(r => console.log(r));
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
