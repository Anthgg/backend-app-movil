const { query } = require('../src/config/database');

async function deleteAdminQADevice() {
  const email = 'admin.qa@demo.com';
  console.log(`Buscando usuario: ${email}...`);

  try {
    const userRes = await query('SELECT id FROM public.users WHERE email = $1', [email]);
    
    if (userRes.rows.length === 0) {
      console.error('❌ Usuario no encontrado.');
      process.exit(1);
    }

    const userId = userRes.rows[0].id;
    console.log(`✅ Usuario encontrado (ID: ${userId}). Eliminando dispositivos...`);

    const deleteRes = await query('DELETE FROM public.user_devices WHERE user_id = $1', [userId]);
    
    console.log(`✅ Se eliminaron ${deleteRes.rowCount} dispositivos.`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

deleteAdminQADevice();
