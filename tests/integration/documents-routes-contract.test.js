const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/documents-service/service', () => ({
  getCompanyDocuments: jest.fn(),
  getDocumentById: jest.fn(),
  uploadDocument: jest.fn(),
  reviewDocument: jest.fn(),
  deleteDocument: jest.fn(),
  getDocumentTypes: jest.fn()
}));

jest.mock('../../src/shared/middlewares/auth.middleware', () => ({
  authenticateToken: (req, res, next) => {
    if (req.get('Authorization') !== 'Bearer valid-token') {
      return res.status(401).json({ success: false, errorCode: 'BEARER_TOKEN_REQUIRED' });
    }
    req.user = {
      id: '33333333-3333-4333-8333-333333333333',
      company_id: '11111111-1111-4111-8111-111111111111',
      roles: [req.get('X-Test-Role') || 'ADMIN']
    };
    return next();
  }
}));

jest.mock('../../src/shared/utils/audit', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined)
}));

const documentsService = require('../../src/services/documents-service/service');
const documentsRouter = require('../../src/services/documents-service/admin.routes');

const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';
const documentDto = {
  id: DOCUMENT_ID,
  workerId: WORKER_ID,
  workerName: 'Ada Lovelace',
  type: 'DNI',
  documentType: 'DNI',
  title: 'Copia de DNI',
  status: 'pending',
  fileName: 'dni.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100,
  fileUrl: 'https://storage.example/dni.pdf',
  uploadedAt: '2026-06-30T00:00:00.000Z',
  reviewedAt: null,
  reviewComment: null,
  canDelete: true,
  canReplace: true
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/documents', documentsRouter);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({
    success: false,
    errorCode: error.errorCode || 'INTERNAL_SERVER_ERROR',
    message: error.message
  }));
  return app;
}

describe('Document Center HTTP contract', () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
    documentsService.getCompanyDocuments.mockResolvedValue({
      documents: [documentDto],
      pagination: { total: 1, page: 1, pageSize: 10 }
    });
    documentsService.getDocumentTypes.mockResolvedValue([
      'DNI', 'CV', 'MEDICAL_CERTIFICATE', 'BACKGROUND_CHECK', 'STUDIES_CERTIFICATE'
    ]);
    documentsService.getDocumentById.mockResolvedValue(documentDto);
    documentsService.uploadDocument.mockResolvedValue(documentDto);
    documentsService.reviewDocument.mockResolvedValue({ ...documentDto, status: 'approved' });
    documentsService.deleteDocument.mockResolvedValue({ id: DOCUMENT_ID, deleted: true });
  });

  test('exige autenticación Bearer', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.statusCode).toBe(401);
  });

  test('aplica autorización por roles', async () => {
    const res = await request(app)
      .get('/api/documents')
      .set('Authorization', 'Bearer valid-token')
      .set('X-Test-Role', 'TRABAJADOR');

    expect(res.statusCode).toBe(403);
    expect(res.body.errorCode).toBe('INSUFFICIENT_ROLE');
  });

  test('GET /api/documents devuelve la forma plana esperada', async () => {
    const res = await request(app)
      .get('/api/documents?page=1&pageSize=10')
      .set('Authorization', 'Bearer valid-token');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [documentDto], total: 1, page: 1, pageSize: 10 });
  });

  test('GET /api/documents/types devuelve un arreglo plano', async () => {
    const res = await request(app)
      .get('/api/documents/types')
      .set('Authorization', 'Bearer valid-token');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(['DNI', 'CV', 'MEDICAL_CERTIFICATE', 'BACKGROUND_CHECK', 'STUDIES_CERTIFICATE']);
  });

  test('GET /api/documents/:documentId devuelve el DTO directo', async () => {
    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(documentDto);
  });

  test('POST acepta exactamente un archivo bajo file y responde 201', async () => {
    const res = await request(app)
      .post(`/api/documents/workers/${WORKER_ID}`)
      .set('Authorization', 'Bearer valid-token')
      .field('type', 'DNI')
      .field('title', 'Copia de DNI')
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), {
        filename: 'dni.pdf',
        contentType: 'application/pdf'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(documentDto);
    expect(documentsService.uploadDocument).toHaveBeenCalledWith(expect.objectContaining({
      workerId: WORKER_ID,
      file: expect.objectContaining({ fieldname: 'file', originalname: 'dni.pdf' })
    }));
  });

  test('POST rechaza campos de archivo distintos de file', async () => {
    const res = await request(app)
      .post(`/api/documents/workers/${WORKER_ID}`)
      .set('Authorization', 'Bearer valid-token')
      .field('type', 'DNI')
      .field('title', 'Copia de DNI')
      .attach('documents', Buffer.from('%PDF-1.4\n%%EOF'), {
        filename: 'dni.pdf',
        contentType: 'application/pdf'
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_DOCUMENT_FILE_FIELD');
    expect(documentsService.uploadDocument).not.toHaveBeenCalled();
  });

  test('PATCH usa la ruta review y devuelve 200', async () => {
    const res = await request(app)
      .patch(`/api/documents/${DOCUMENT_ID}/review`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'approved' });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  test('DELETE responde 204 sin body', async () => {
    const res = await request(app)
      .delete(`/api/documents/${DOCUMENT_ID}`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.statusCode).toBe(204);
    expect(res.text).toBe('');
  });

  test('valida UUID en parámetros', async () => {
    const res = await request(app)
      .get('/api/documents/not-a-uuid')
      .set('Authorization', 'Bearer valid-token');

    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_DOCUMENT_ID');
  });
});
