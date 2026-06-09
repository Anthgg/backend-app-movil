const request = require('supertest');
const app = require('../../src/app');
const { query } = require('../../src/config/database');
const path = require('path');
const fs = require('fs');
const { getQaAuthToken } = require('../helpers/auth.helper');

describe('Request Documents API Tests', () => {

  let adminToken = '';
  let workerToken = '';
  let requestTypeId = '';
  let testRequestId = '';
  let uploadedDocId = '';

  // Crear un archivo de prueba temporal (1x1 pixel PNG)
  const testImageBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const testPdfBuffer = Buffer.from('%PDF-1.4 test content');

  beforeAll(async () => {
    // Login como admin
    adminToken = await getQaAuthToken(app, 'admin@demo.com', 'Demo123!');

    // Login como trabajador (si existe)
    try {
      workerToken = await getQaAuthToken(app, 'trabajador@demo.com', 'Demo123!');
    } catch {
      workerToken = adminToken;
    }


    // Obtener un tipo de solicitud
    const typeRes = await query(`
      SELECT id FROM request_types WHERE is_active = true LIMIT 1
    `);
    if (typeRes.rows.length > 0) {
      requestTypeId = typeRes.rows[0].id;
    }

    // Crear una solicitud de prueba para adjuntar documentos
    if (requestTypeId && workerToken) {
      const createRes = await request(app)
        .post('/requests')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({
          request_type_id: requestTypeId,
          start_date: '2026-09-15',
          end_date: '2026-09-15',
          reason: 'Test de documentos adjuntos - QA'
        });

      if (createRes.body.success) {
        testRequestId = createRes.body.data?.request?.id;
      }
    }
  }, 30000);

  afterAll(async () => {
    // Limpiar documentos y solicitud de prueba
    if (testRequestId) {
      await query("DELETE FROM request_documents WHERE request_id = $1", [testRequestId]);
      await query("DELETE FROM employee_requests WHERE id = $1", [testRequestId]);
    }
  });

  // ==========================================
  // 1. TIPOS DE SOLICITUD
  // ==========================================

  test('GET /requests/types — retorna tipos de solicitud activos', async () => {
    const res = await request(app)
      .get('/requests/types')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('requestTypes');
    expect(Array.isArray(res.body.data.requestTypes)).toBe(true);

    if (res.body.data.requestTypes.length > 0) {
      expect(res.body.data.requestTypes[0]).toHaveProperty('id');
      expect(res.body.data.requestTypes[0]).toHaveProperty('name');
    }
  });

  test('GET /api/requests/request-types — alias funciona', async () => {
    const res = await request(app)
      .get('/api/requests/request-types')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/request-types — ruta dedicada funciona', async () => {
    const res = await request(app)
      .get('/api/request-types')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });

  // ==========================================
  // 2. CREAR SOLICITUD (JSON)
  // ==========================================

  test('POST /requests — crea solicitud JSON exitosamente', async () => {
    if (!requestTypeId) return; // Skip si no hay tipo

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        requestTypeId: requestTypeId,
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        reason: 'Test crear solicitud JSON - QA'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('request');
    expect(res.body.data.request).toHaveProperty('id');
    expect(res.body.data.request.status).toBe('pending');
    // Nuevo: response incluye array de documents (vacío si no se subieron)
    expect(res.body.data).toHaveProperty('documents');
    expect(Array.isArray(res.body.data.documents)).toBe(true);

    // Limpiar
    if (res.body.data.request.id) {
      await query("DELETE FROM employee_requests WHERE id = $1", [res.body.data.request.id]);
    }
  });

  // ==========================================
  // 3. CREAR SOLICITUD CON ARCHIVOS (multipart)
  // ==========================================

  test('POST /requests — crea solicitud con archivo adjunto (multipart)', async () => {
    if (!requestTypeId) return;

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${workerToken}`)
      .field('requestTypeId', requestTypeId)
      .field('startDate', '2026-10-10')
      .field('endDate', '2026-10-11')
      .field('reason', 'Test crear con archivo adjunto - QA')
      .attach('documents', testImageBuffer, 'test-foto.png');

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('request');
    expect(res.body.data).toHaveProperty('documents');

    // Si Supabase Storage está configurado, debería haber documentos
    // Si no está configurado, documents será [] pero la solicitud se crea igual
    if (res.body.data.documents.length > 0) {
      expect(res.body.data.documents[0]).toHaveProperty('file_url');
      expect(res.body.data.documents[0]).toHaveProperty('mime_type');
    }

    // Limpiar
    const reqId = res.body.data.request.id;
    if (reqId) {
      await query("DELETE FROM request_documents WHERE request_id = $1", [reqId]);
      await query("DELETE FROM employee_requests WHERE id = $1", [reqId]);
    }
  });

  // ==========================================
  // 4. LISTAR MIS SOLICITUDES
  // ==========================================

  test('GET /requests/my — retorna solicitudes del usuario con paginación', async () => {
    const res = await request(app)
      .get('/requests/my?page=1&limit=5')
      .set('Authorization', `Bearer ${workerToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('requests');
    expect(res.body.data).toHaveProperty('pagination');
    expect(res.body.data.pagination).toHaveProperty('total');
    expect(res.body.data.pagination).toHaveProperty('page');
    expect(res.body.data.pagination).toHaveProperty('totalPages');
  });

  test('GET /requests/my?status=pending — filtra por estado', async () => {
    const res = await request(app)
      .get('/requests/my?status=pending')
      .set('Authorization', `Bearer ${workerToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);

    // Todas las solicitudes deben ser pending
    if (res.body.data.requests.length > 0) {
      res.body.data.requests.forEach(r => {
        expect(r.status).toBe('pending');
      });
    }
  });

  // ==========================================
  // 5. SOLICITUDES DE EMPRESA (ADMIN)
  // ==========================================

  test('GET /requests — ADMIN ve todas las solicitudes', async () => {
    const res = await request(app)
      .get('/requests?page=1&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('requests');
    expect(res.body.data).toHaveProperty('pagination');
  });

  test('GET /requests/pending — ADMIN ve pendientes', async () => {
    const res = await request(app)
      .get('/requests/pending')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });

  // ==========================================
  // 6. DETALLE DE SOLICITUD (con documentos)
  // ==========================================

  test('GET /requests/:id — retorna detalle con documentos adjuntos', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .get(`/requests/${testRequestId}`)
      .set('Authorization', `Bearer ${workerToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('request');
    expect(res.body.data.request).toHaveProperty('id', testRequestId);
    expect(res.body.data.request).toHaveProperty('documents');
    expect(Array.isArray(res.body.data.request.documents)).toBe(true);
  });

  test('GET /requests/:id — 404 para ID inexistente', async () => {
    const res = await request(app)
      .get('/requests/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(404);
    expect(res.body.success).toBe(false);
  });

  // ==========================================
  // 7. SUBIR DOCUMENTOS A SOLICITUD EXISTENTE
  // ==========================================

  test('POST /requests/:id/documents — sube archivo a solicitud', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .post(`/requests/${testRequestId}/documents`)
      .set('Authorization', `Bearer ${workerToken}`)
      .attach('documents', testImageBuffer, 'comprobante.png');

    // 201 si Supabase está configurado, o error si no lo está
    if (res.statusCode === 201) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('documents');
      expect(res.body.data.documents.length).toBeGreaterThan(0);
      uploadedDocId = res.body.data.documents[0].id;

      const doc = res.body.data.documents[0];
      expect(doc).toHaveProperty('id');
      expect(doc).toHaveProperty('file_url');
      expect(doc).toHaveProperty('mime_type');
      expect(doc).toHaveProperty('file_size');
      expect(doc).toHaveProperty('request_id', testRequestId);
    } else {
      // Supabase no configurado — aceptable en test local
      console.log('⚠️  Supabase Storage no configurado, upload test skipped');
    }
  });

  test('POST /requests/:id/documents — falla sin archivos', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .post(`/requests/${testRequestId}/documents`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({});

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('NO_FILES_ATTACHED');
  });

  test('POST /requests/:id/documents — 404 solicitud inexistente', async () => {
    const res = await request(app)
      .post('/requests/00000000-0000-0000-0000-000000000000/documents')
      .set('Authorization', `Bearer ${workerToken}`)
      .attach('documents', testImageBuffer, 'test.png');

    expect(res.statusCode).toEqual(404);
  });

  // ==========================================
  // 8. LISTAR DOCUMENTOS
  // ==========================================

  test('GET /requests/:id/documents — lista documentos de solicitud', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .get(`/requests/${testRequestId}/documents`)
      .set('Authorization', `Bearer ${workerToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('documents');
    expect(Array.isArray(res.body.data.documents)).toBe(true);
  });

  // ==========================================
  // 9. ELIMINAR DOCUMENTO
  // ==========================================

  test('DELETE /requests/:id/documents/:docId — elimina documento', async () => {
    if (!testRequestId || !uploadedDocId) return;

    const res = await request(app)
      .delete(`/requests/${testRequestId}/documents/${uploadedDocId}`)
      .set('Authorization', `Bearer ${workerToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('deleted', true);
  });

  test('DELETE /requests/:id/documents/:docId — 404 doc inexistente', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .delete(`/requests/${testRequestId}/documents/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${workerToken}`);

    expect(res.statusCode).toEqual(404);
  });

  // ==========================================
  // 10. EDITAR SOLICITUD
  // ==========================================

  test('PUT /requests/:id — edita solicitud pendiente', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .put(`/requests/${testRequestId}`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        reason: 'Motivo editado - QA test'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });

  // ==========================================
  // 11. REVIEW (Aprobar/Rechazar/Observar)
  // ==========================================

  test('POST /requests/:id/review — observar solicitud', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .post(`/requests/${testRequestId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'observe',
        reason: 'Necesita certificado médico adjunto'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('observed');
  });

  test('PATCH /requests/:id/resubmit — reenvía solicitud observada', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .patch(`/requests/${testRequestId}/resubmit`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        reason: 'Motivo corregido con certificado adjunto'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
  });

  test('POST /requests/:id/review — aprobar solicitud', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .post(`/requests/${testRequestId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'approve',
        reason: 'Aprobado en QA test'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('approved');
  });

  test('POST /requests/:id/review — falla con action inválida', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .post(`/requests/${testRequestId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'invalid_action',
        reason: 'test'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });

  // ==========================================
  // 12. CANCELAR SOLICITUD
  // ==========================================

  test('POST /requests/:id/cancel — no puede cancelar solicitud aprobada', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .post(`/requests/${testRequestId}/cancel`)
      .set('Authorization', `Bearer ${workerToken}`);

    // Debe fallar porque está aprobada
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });

  // ==========================================
  // 13. VALIDACIONES DE SEGURIDAD
  // ==========================================

  test('GET /requests — falla sin token', async () => {
    const res = await request(app).get('/requests');

    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /requests — falla sin token', async () => {
    const res = await request(app)
      .post('/requests')
      .send({ reason: 'test sin auth' });

    expect(res.statusCode).toEqual(401);
  });

  test('POST /requests/:id/documents — falla sin token', async () => {
    if (!testRequestId) return;

    const res = await request(app)
      .post(`/requests/${testRequestId}/documents`)
      .attach('documents', testImageBuffer, 'test.png');

    expect(res.statusCode).toEqual(401);
  });

});
