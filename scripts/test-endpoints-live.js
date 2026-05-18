const request = require('supertest');
const app = require('../src/app');
const { query } = require('../src/config/database');

async function runTests() {
  console.log('🧪 Iniciando pruebas de integración de Reportes y Plantillas...');

  let adminToken = '';
  let workerToken = '';

  // 1. Iniciar sesión como ADMIN
  console.log('\n🔑 1. Intentando login de ADMIN...');
  const adminLoginRes = await request(app)
    .post('/api/login')
    .send({
      email: 'admin.corporativo@test.com',
      password: 'Demo1234!'
    });

  if (adminLoginRes.body && adminLoginRes.body.success) {
    adminToken = adminLoginRes.body.data.accessToken;
    console.log('✅ ADMIN logueado con éxito. Token:', adminToken.slice(0, 20) + '...');
  } else {
    console.error('❌ Error de login ADMIN:', adminLoginRes.body);
    process.exit(1);
  }

  // 2. Iniciar sesión como TRABAJADOR
  console.log('\n🔑 2. Intentando login de TRABAJADOR...');
  const workerLoginRes = await request(app)
    .post('/api/login')
    .send({
      email: 'trabajador.corporativo@test.com',
      password: 'Demo1234!'
    });

  if (workerLoginRes.body && workerLoginRes.body.success) {
    workerToken = workerLoginRes.body.data.accessToken;
    console.log('✅ TRABAJADOR logueado con éxito. Token:', workerToken.slice(0, 20) + '...');
  } else {
    console.error('❌ Error de login TRABAJADOR:', workerLoginRes.body);
    process.exit(1);
  }

  // 3. Crear solicitud dummy para que existan datos de prueba
  console.log('\n📝 3. Creando solicitud dummy para Pedro (Trabajador) en base de datos...');
  
  // Obtener IDs
  const workerIdRes = await query("SELECT id, company_id FROM workers WHERE document_number = '88776655'");
  const workerId = workerIdRes.rows[0].id;
  const companyId = workerIdRes.rows[0].company_id;

  const typeRes = await query("SELECT id FROM request_types LIMIT 1");
  let typeId = null;
  
  if (typeRes.rows.length === 0) {
    // Si no hay tipos de solicitudes, creamos uno
    const insertTypeRes = await query(`
      INSERT INTO request_types (company_id, name, code, description, max_days, requires_attachment, is_active)
      VALUES ($1, 'Permiso personal', 'PERMISO_PERSONAL', 'Permiso para asuntos propios', 3, false, true)
      RETURNING id
    `, [companyId]);
    typeId = insertTypeRes.rows[0].id;
    console.log('✅ Creado tipo de solicitud dummy.');
  } else {
    typeId = typeRes.rows[0].id;
  }

  // Insertar solicitud dummy en employee_requests
  await query(`
    INSERT INTO employee_requests (company_id, worker_id, request_type_id, start_date, end_date, days_requested, reason, status)
    VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '1 day', 2, 'Motivo de prueba de reportes', 'approved')
    ON CONFLICT DO NOTHING
  `, [companyId, workerId, typeId]);
  console.log('✅ Solicitud dummy aprobada insertada en DB.');

  // 4. Probar Previsualización del reporte (ADMIN)
  console.log('\n📊 4. Probando POST /api/requests/reports/preview (ADMIN)...');
  const previewRes = await request(app)
    .post('/api/requests/reports/preview')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      filters: {
        status: 'approved'
      },
      columns: ['worker_name', 'request_type', 'status', 'start_date', 'end_date'],
      limit: 10
    });

  console.log('Status Code:', previewRes.status);
  console.log('Response Body Keys:', Object.keys(previewRes.body));
  console.log('Response Success:', previewRes.body.success);
  console.log('Total Registros:', previewRes.body.total);
  console.log('Registros devueltos:', previewRes.body.data.length);
  if (previewRes.body.data.length > 0) {
    console.log('Primer registro previsualizado:', previewRes.body.data[0]);
  }

  if (previewRes.status !== 200 || !previewRes.body.success) {
    console.error('❌ Falló prueba de previsualización.');
    process.exit(1);
  }
  console.log('✅ Prueba de previsualización exitosa.');

  // 5. Probar Exportación a Excel y PDF (ADMIN)
  console.log('\n📥 5. Probando exportación a Excel y PDF (ADMIN)...');
  
  const excelRes = await request(app)
    .post('/api/requests/reports/export/excel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      filters: { status: 'approved' },
      columns: ['worker_name', 'request_type', 'status']
    });

  console.log('Excel Status Code:', excelRes.status);
  console.log('Excel Content-Type:', excelRes.headers['content-type']);
  if (excelRes.status !== 200 || !excelRes.headers['content-type'].includes('spreadsheetml')) {
    console.error('❌ Falló exportación Excel.');
    process.exit(1);
  }
  console.log('✅ Exportación a Excel exitosa.');

  const pdfRes = await request(app)
    .post('/api/requests/reports/export/pdf')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      filters: { status: 'approved' },
      columns: ['worker_name', 'request_type', 'status']
    });

  console.log('PDF Status Code:', pdfRes.status);
  console.log('PDF Content-Type:', pdfRes.headers['content-type']);
  if (pdfRes.status !== 200 || !pdfRes.headers['content-type'].includes('pdf')) {
    console.error('❌ Falló exportación PDF.');
    process.exit(1);
  }
  console.log('✅ Exportación a PDF exitosa.');

  // 6. Probar CRUD de Plantillas Personalizadas
  console.log('\n📋 6. Probando CRUD de Plantillas de Reportes...');

  // 6.1 Crear Plantilla
  console.log('  -> Creando plantilla...');
  const createTemplateRes = await request(app)
    .post('/api/report-templates')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Reporte Mensual Aprobado',
      description: 'Reporte para solicitudes aprobadas del mes',
      module: 'requests',
      reportType: 'requests_excel',
      filters: { status: 'approved' },
      columns: ['worker_name', 'request_type', 'status'],
      isDefault: true
    });

  console.log('  Create Status:', createTemplateRes.status);
  console.log('  Create Success:', createTemplateRes.body.success);
  
  if (createTemplateRes.status !== 201 || !createTemplateRes.body.success) {
    console.error('❌ Falló creación de plantilla.');
    process.exit(1);
  }
  const templateId = createTemplateRes.body.data.id;
  console.log('  ✅ Plantilla creada con ID:', templateId);

  // 6.2 Listar Plantillas
  console.log('  -> Listando plantillas...');
  const listTemplatesRes = await request(app)
    .get('/api/report-templates?module=requests')
    .set('Authorization', `Bearer ${adminToken}`);

  console.log('  List Status:', listTemplatesRes.status);
  console.log('  List Count:', listTemplatesRes.body.data.length);
  if (listTemplatesRes.status !== 200 || listTemplatesRes.body.data.length === 0) {
    console.error('❌ Falló listado de plantillas.');
    process.exit(1);
  }
  console.log('  ✅ Listado exitoso.');

  // 6.3 Obtener Plantilla por ID
  console.log('  -> Obteniendo plantilla por ID...');
  const getTemplateRes = await request(app)
    .get(`/api/report-templates/${templateId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  console.log('  Get ID Status:', getTemplateRes.status);
  console.log('  Name retrieved:', getTemplateRes.body.data.name);
  if (getTemplateRes.status !== 200 || getTemplateRes.body.data.name !== 'Reporte Mensual Aprobado') {
    console.error('❌ Falló obtener plantilla.');
    process.exit(1);
  }
  console.log('  ✅ Obtener por ID exitoso.');

  // 6.4 Actualizar Plantilla
  console.log('  -> Actualizando plantilla...');
  const updateTemplateRes = await request(app)
    .put(`/api/report-templates/${templateId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Reporte Mensual Actualizado',
      description: 'Descripción actualizada'
    });

  console.log('  Update Status:', updateTemplateRes.status);
  console.log('  New Name:', updateTemplateRes.body.data.name);
  if (updateTemplateRes.status !== 200 || updateTemplateRes.body.data.name !== 'Reporte Mensual Actualizado') {
    console.error('❌ Falló actualizar plantilla.');
    process.exit(1);
  }
  console.log('  ✅ Actualización de plantilla exitosa.');

  // 7. Probar Gráficos Estadísticos y Resumen
  console.log('\n📈 7. Probando Gráficos y Resumen Estadístico (ADMIN)...');
  
  // 7.1 Gráficos agrupados por Trabajador
  console.log('  -> Gráfico agrupado por worker...');
  const chartRes = await request(app)
    .post('/api/requests/reports/charts')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      groupBy: 'worker',
      metric: 'total_requests',
      limit: 5
    });

  console.log('  Chart Status:', chartRes.status);
  console.log('  Chart Title:', chartRes.body.data.title);
  console.log('  Labels:', chartRes.body.data.labels);
  console.log('  Dataset Data:', chartRes.body.data.datasets[0].data);
  if (chartRes.status !== 200 || !chartRes.body.success) {
    console.error('❌ Falló carga de gráfico.');
    process.exit(1);
  }
  console.log('  ✅ Gráfico exitoso.');

  // 7.2 Gráficos con promedio de días
  console.log('  -> Gráfico agrupado por worker con metric average_days...');
  const chartDaysRes = await request(app)
    .post('/api/requests/reports/charts')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      groupBy: 'worker',
      metric: 'average_days',
      limit: 5
    });

  console.log('  Chart Days Title:', chartDaysRes.body.data.title);
  console.log('  Dataset Label:', chartDaysRes.body.data.datasets[0].label);
  console.log('  Dataset Data:', chartDaysRes.body.data.datasets[0].data);
  if (chartDaysRes.status !== 200 || !chartDaysRes.body.data.datasets[0].label.includes('Promedio')) {
    console.error('❌ Falló carga de gráfico por promedio de días.');
    process.exit(1);
  }
  console.log('  ✅ Gráfico promedio de días exitoso.');

  // 7.3 Resumen general
  console.log('  -> Resumen general de dashboard...');
  const summaryRes = await request(app)
    .post('/api/requests/reports/summary')
    .set('Authorization', `Bearer ${adminToken}`);

  console.log('  Summary Status:', summaryRes.status);
  console.log('  Summary Metrics:', summaryRes.body.data);
  if (summaryRes.status !== 200 || summaryRes.body.data.totalRequests === undefined) {
    console.error('❌ Falló resumen general.');
    process.exit(1);
  }
  console.log('  ✅ Resumen general exitoso.');

  // 8. Probar Restricciones y Seguridad de TRABAJADOR
  console.log('\n🔒 8. Probando restricciones de rol TRABAJADOR...');
  
  // 8.1 Previsualizar - Debe devolver solo sus propias solicitudes (Pedro)
  console.log('  -> Previsualización de Trabajador (debe filtrar solo Pedro)...');
  const workerPreviewRes = await request(app)
    .post('/api/requests/reports/preview')
    .set('Authorization', `Bearer ${workerToken}`)
    .send({
      columns: ['worker_name', 'status']
    });

  console.log('  Worker Preview Status:', workerPreviewRes.status);
  console.log('  Worker Preview Records Count:', workerPreviewRes.body.data.length);
  if (workerPreviewRes.body.data.length > 0) {
    const allPedro = workerPreviewRes.body.data.every(r => r.worker_name.includes('Pedro'));
    console.log('  ¿Todos los registros pertenecen a Pedro?:', allPedro);
    if (!allPedro) {
      console.error('❌ Seguridad vulnerada: Trabajador vio solicitudes de otros trabajadores!');
      process.exit(1);
    }
  }
  console.log('  ✅ Seguridad de previsualización de Trabajador validada exitosamente.');

  // 8.2 Crear plantilla de Trabajador (no debe ser default)
  console.log('  -> Trabajador intentando crear plantilla default...');
  const workerCreateRes = await request(app)
    .post('/api/report-templates')
    .set('Authorization', `Bearer ${workerToken}`)
    .send({
      name: 'Mi Plantilla Personal',
      module: 'requests',
      reportType: 'requests_excel',
      filters: {},
      columns: ['worker_name'],
      isDefault: true // Intentando forzar default
    });

  console.log('  Worker Create Status:', workerCreateRes.status);
  console.log('  Template Created isDefault flag:', workerCreateRes.body.data.is_default);
  if (workerCreateRes.body.data.is_default) {
    console.error('❌ Seguridad vulnerada: Trabajador pudo marcar plantilla como default!');
    process.exit(1);
  }
  console.log('  ✅ Seguridad de creación de plantilla Trabajador validada exitosamente.');
  
  const workerTemplateId = workerCreateRes.body.data.id;

  // 8.3 Trabajador intentando ver plantilla default de ADMIN - Debe poder verla
  console.log('  -> Trabajador cargando plantillas...');
  const workerListRes = await request(app)
    .get('/api/report-templates?module=requests')
    .set('Authorization', `Bearer ${workerToken}`);

  console.log('  Worker List Templates Count:', workerListRes.body.data.length);
  const containsAdminDefault = workerListRes.body.data.some(t => t.id === templateId);
  const containsOwn = workerListRes.body.data.some(t => t.id === workerTemplateId);
  console.log('  ¿Contiene plantilla default de ADMIN?:', containsAdminDefault);
  console.log('  ¿Contiene su propia plantilla?:', containsOwn);
  if (!containsAdminDefault || !containsOwn) {
    console.error('❌ Listado de plantillas incorrecto para trabajador.');
    process.exit(1);
  }
  console.log('  ✅ Listado de plantillas Trabajador validado.');

  // 8.4 Trabajador intentando editar plantilla de ADMIN - Debe fallar con 403
  console.log('  -> Trabajador editando plantilla de ADMIN...');
  const workerEditAdminRes = await request(app)
    .put(`/api/report-templates/${templateId}`)
    .set('Authorization', `Bearer ${workerToken}`)
    .send({
      name: 'Hackeado'
    });

  console.log('  Edit Admin Status:', workerEditAdminRes.status);
  if (workerEditAdminRes.status !== 403) {
    console.error('❌ Seguridad vulnerada: Trabajador pudo editar plantilla de ADMIN!');
    process.exit(1);
  }
  console.log('  ✅ Bloqueo de edición de plantilla ajena validado exitosamente.');

  // 6.5 Limpieza (Eliminar Plantilla de ADMIN)
  console.log('\n🧹 9. Limpieza de base de datos...');
  const deleteRes = await request(app)
    .delete(`/api/report-templates/${templateId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  console.log('  Delete Admin Status:', deleteRes.status);
  
  const deleteWorkerTemplateRes = await request(app)
    .delete(`/api/report-templates/${workerTemplateId}`)
    .set('Authorization', `Bearer ${workerToken}`);

  console.log('  Delete Worker Status:', deleteWorkerTemplateRes.status);

  console.log('\n✨ ¡TODAS LAS PRUEBAS DE INTEGRACIÓN PASARON EXITOSAMENTE! 🚀💯');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Error fatal ejecutando pruebas:', err);
  process.exit(1);
});
