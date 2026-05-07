const { Client } = require('pg');
require('dotenv').config();

async function deleteWorkerDevice() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // 1. Buscar el usuario
    const userRes = await client.query(
      "SELECT id, email, first_name, last_name FROM users WHERE (first_name || ' ' || last_name) ILIKE '%QA%' OR email ILIKE '%qa%'"
    );

    if (userRes.rows.length === 0) {
      console.log('No se encontraron usuarios con "QA" en el nombre o email.');
      return;
    }

    console.log('Usuarios encontrados:');
    userRes.rows.forEach(u => console.log(`- ${u.first_name} ${u.last_name} (${u.email}) [ID: ${u.id}]`));

    // Intentar encontrar el más parecido a "TRABAJADOR 1 QA"
    const targetUser = userRes.rows.find(u => 
      (`${u.first_name} ${u.last_name}`).toUpperCase().includes('TRABAJADOR 1') || 
      u.email.toUpperCase().includes('TRABAJADOR1')
    ) || userRes.rows[0];

    const userId = targetUser.id;
    const userEmail = targetUser.email;
    console.log(`\nSeleccionado para eliminar dispositivo: ${userEmail} (${userId})`);

    // 2. Buscar dispositivos
    const deviceRes = await client.query(
      "SELECT id, device_identifier, device_name FROM user_devices WHERE user_id = $1",
      [userId]
    );

    if (deviceRes.rows.length === 0) {
      console.log('No se encontraron dispositivos asociados a este usuario.');
      return;
    }

    console.log(`Se encontraron ${deviceRes.rows.length} dispositivos. Procediendo a eliminar...`);

    // 3. Eliminar dispositivos
    const deleteRes = await client.query(
      "DELETE FROM user_devices WHERE user_id = $1",
      [userId]
    );

    console.log(`Éxito: Se eliminaron ${deleteRes.rowCount} registros de dispositivos para el usuario ${userEmail}.`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

deleteWorkerDevice();
