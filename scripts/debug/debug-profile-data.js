const { query } = require('../../src/config/database');
const profileService = require('../../src/services/profile-service/service');

async function main() {
  const args = process.argv.slice(2);
  let email = '';
  let documentNumber = '';

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      email = arg.split('=')[1];
    } else if (arg.startsWith('--document=')) {
      documentNumber = arg.split('=')[1];
    }
  }

  if (!email && !documentNumber) {
    console.error('Error: Debes proporcionar --email=... o --document=...');
    console.log('Ejemplo: node scripts/debug/debug-profile-data.js --email=enori.espinoza@fabryor.com');
    process.exit(1);
  }

  try {
    console.log('=== INICIANDO DIAGNÓSTICO DE PERFIL ===');
    let userRow = null;

    if (email) {
      console.log(`Buscando usuario por email: ${email}`);
      const userRes = await query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1', [email]);
      userRow = userRes.rows[0];
    } else {
      console.log(`Buscando usuario por número de documento: ${documentNumber}`);
      const workerRes = await query('SELECT * FROM workers WHERE document_number = $1 AND deleted_at IS NULL LIMIT 1', [documentNumber]);
      const worker = workerRes.rows[0];
      if (worker && worker.user_id) {
        const userRes = await query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [worker.user_id]);
        userRow = userRes.rows[0];
      }
    }

    if (!userRow) {
      console.error('Usuario no encontrado.');
      process.exit(1);
    }

    console.log('\n[Usuario encontrado]');
    console.log(`ID: ${userRow.id}`);
    console.log(`Nombre: ${userRow.full_name || `${userRow.first_name} ${userRow.last_name}`}`);
    console.log(`Email: ${userRow.email}`);
    console.log(`Compañía/Tenant ID: ${userRow.company_id}`);

    const workerRes = await query(
      'SELECT * FROM workers WHERE (user_id = $1 OR id = $2) AND deleted_at IS NULL LIMIT 1',
      [userRow.id, userRow.worker_id]
    );
    const workerRow = workerRes.rows[0];

    if (!workerRow) {
      console.error('\nNo se encontró un worker asociado a este usuario.');
      process.exit(0);
    }

    console.log('\n[Worker asociado]');
    console.log(`ID: ${workerRow.id}`);
    console.log(`DNI / Documento: ${workerRow.document_number}`);

    console.log('\n[Datos personales en BD]');
    console.log(`Fecha de nacimiento: ${workerRow.birth_date}`);
    console.log(`Género: ${workerRow.gender}`);
    console.log(`Estado civil: ${workerRow.civil_status}`);
    console.log(`Nacionalidad: ${workerRow.nationality}`);
    console.log(`Dirección: ${workerRow.address}`);
    console.log(`Departamento Geográfico ID (ubigeo): ${workerRow.department_id}`);
    console.log(`Provincia ID (ubigeo): ${workerRow.province_id}`);
    console.log(`Distrito ID (ubigeo): ${workerRow.district_id}`);
    console.log(`Departamento Geográfico Texto: ${workerRow.department}`);
    console.log(`Provincia Texto: ${workerRow.province}`);
    console.log(`Distrito Texto: ${workerRow.district}`);

    console.log('\n[Datos laborales en BD]');
    console.log(`Departamento Interno ID: ${workerRow.internal_department_id}`);
    console.log(`Área ID: ${workerRow.area_id}`);
    console.log(`Cargo (Position) ID: ${workerRow.position_id}`);
    console.log(`Obra (Work Location) ID: ${workerRow.work_location_id}`);

    console.log('\n[Datos de emergencia en BD]');
    console.log(`Contacto: ${workerRow.emergency_contact_name}`);
    console.log(`Teléfono: ${workerRow.emergency_contact_phone}`);
    console.log(`Parentesco/Relación: ${workerRow.emergency_contact_relationship}`);

    console.log('\n[Respuesta actual de /api/profile/current (serialized)]');
    const profile = await profileService.getProfile(userRow.id, userRow.company_id, ['ADMIN']);
    console.log(JSON.stringify(profile, null, 2));

    console.log('\n[Campos faltantes / vacíos en respuesta]');
    const fieldsToCheck = [
      { key: 'gender', name: 'Género' },
      { key: 'civilStatus', name: 'Estado civil' },
      { key: 'departmentGeo', name: 'Departamento geográfico' },
      { key: 'province', name: 'Provincia' },
      { key: 'district', name: 'Distrito' },
      { key: 'emergencyContactName', name: 'Contacto de emergencia' },
      { key: 'emergencyContactPhone', name: 'Teléfono de emergencia' },
      { key: 'emergencyContactRelationship', name: 'Parentesco de contacto' }
    ];

    const missing = [];
    for (const field of fieldsToCheck) {
      const val = profile[field.key] || (profile.worker && profile.worker[field.key]);
      if (!val) {
        missing.push(field);
        console.log(`❌ ${field.name} (${field.key}): VACÍO`);
      } else {
        console.log(`✅ ${field.name} (${field.key}): ${val}`);
      }
    }

    if (missing.length > 0) {
      console.log('\n[Posible causa]');
      for (const field of missing) {
        if (field.key === 'emergencyContactRelationship') {
          if (!workerRow.emergency_contact_relationship) {
            console.log('- emergencyContactRelationship: No guardado en base de datos. Probablemente el normalizador de onboarding o complete-profile no lo está mapeando.');
          } else {
            console.log('- emergencyContactRelationship: Guardado en BD pero no devuelto o serializado en el endpoint.');
          }
        }
        if (['departmentGeo', 'province', 'district'].includes(field.key)) {
          console.log(`- ${field.key}: El worker tiene IDs de ubigeo pero el endpoint no está resolviendo los nombres mediante LEFT JOIN con tablas geográficas.`);
        }
        if (['gender', 'civilStatus'].includes(field.key)) {
          console.log(`- ${field.key}: No guardado en BD o no expuesto.`);
        }
      }
    } else {
      console.log('\n🎉 ¡Todos los datos personales requeridos están completos y se devuelven correctamente!');
    }

  } catch (error) {
    console.error('Error durante diagnóstico:', error);
  } finally {
    process.exit(0);
  }
}

main();
