jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/shared/utils/storage.utils', () => ({
  uploadFile: jest.fn(),
  deleteFile: jest.fn()
}));

const { query } = require('../../src/config/database');
const { uploadFile, deleteFile } = require('../../src/shared/utils/storage.utils');
const documentsService = require('../../src/services/documents-service/service');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';

function pdfFile(contents = 'documento-unico') {
  const buffer = Buffer.from(`%PDF-1.4\n${contents}\n%%EOF`);
  return {
    buffer,
    originalname: 'dni.pdf',
    mimetype: 'application/pdf',
    size: buffer.length
  };
}

function documentRow(overrides = {}) {
  return {
    id: DOCUMENT_ID,
    worker_id: WORKER_ID,
    company_id: COMPANY_ID,
    document_type: 'DNI',
    title: 'Copia de DNI',
    file_name: 'dni.pdf',
    file_url: 'https://storage.example/dni.pdf',
    file_path: `${COMPANY_ID}/workers/${WORKER_ID}/${DOCUMENT_ID}/hash`,
    mime_type: 'application/pdf',
    size_bytes: 100,
    status: 'pending',
    uploaded_at: '2026-06-30T00:00:00.000Z',
    reviewed_at: null,
    review_comment: null,
    worker_name: 'Ada Lovelace',
    metadata: {},
    ...overrides
  };
}

describe('Document Center service contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteFile.mockResolvedValue(undefined);
    uploadFile.mockResolvedValue('https://storage.example/new-document');
  });

  test('lista con paginación, filtros y DTO camelCase esperado', async () => {
    query
      .mockResolvedValueOnce({ rows: [documentRow()] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const result = await documentsService.getCompanyDocuments(COMPANY_ID, {
      page: '2',
      limit: '5',
      status: 'pending',
      type: 'DNI',
      workerId: WORKER_ID,
      search: 'Ada'
    });

    expect(result.pagination).toMatchObject({ total: 1, page: 2, pageSize: 5 });
    expect(result.documents[0]).toMatchObject({
      id: DOCUMENT_ID,
      workerId: WORKER_ID,
      workerName: 'Ada Lovelace',
      type: 'DNI',
      documentType: 'DNI',
      status: 'pending',
      canDelete: true,
      canReplace: true
    });

    const dataCall = query.mock.calls.find(([sql]) => String(sql).includes('LIMIT'));
    expect(dataCall[1]).toEqual(expect.arrayContaining([COMPANY_ID, WORKER_ID, 'pending', 'DNI', '%Ada%', 5, 5]));
  });

  test.each([
    [{ page: '0' }, 'INVALID_PAGINATION', 400],
    [{ pageSize: '101' }, 'INVALID_PAGINATION', 400],
    [{ workerId: 'not-a-uuid' }, 'INVALID_WORKER_ID', 400],
    [{ status: 'archived' }, 'INVALID_DOCUMENT_STATUS', 422],
    [{ status: 'uploaded' }, 'INVALID_DOCUMENT_STATUS', 422],
    [{ type: 'PASSPORT' }, 'INVALID_DOCUMENT_TYPE', 422]
  ])('rechaza filtros inválidos: %j', async (filters, errorCode, statusCode) => {
    await expect(documentsService.getCompanyDocuments(COMPANY_ID, filters)).rejects.toMatchObject({
      errorCode,
      statusCode
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('rechaza por contenido un archivo con extensión PDF falsa', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: WORKER_ID }] });

    await expect(documentsService.uploadDocument({
      file: { buffer: Buffer.from('not-a-pdf'), originalname: 'dni.pdf', mimetype: 'application/pdf', size: 9 },
      body: { type: 'DNI', title: 'DNI' },
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      uploadedBy: USER_ID
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'UNSUPPORTED_DOCUMENT_FILE'
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('detecta duplicados por SHA-256 antes de subir a Storage', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: WORKER_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: DOCUMENT_ID }] });

    await expect(documentsService.uploadDocument({
      file: pdfFile(),
      body: { type: 'DNI', title: 'Copia de DNI' },
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      uploadedBy: USER_ID
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'DUPLICATE_DOCUMENT_FILE'
    });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  test('crea un documento una sola vez con hash y estado pending', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: WORKER_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [documentRow()] });

    const result = await documentsService.uploadDocument({
      file: pdfFile('nuevo'),
      body: { type: 'DNI', title: 'Copia de DNI' },
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      uploadedBy: USER_ID
    });

    expect(result.id).toBe(DOCUMENT_ID);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const insertCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO worker_documents'));
    expect(insertCall[0]).toContain('content_sha256');
    expect(insertCall[1][11]).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each(['rejected', 'observed'])('exige comentario al revisar como %s', async (status) => {
    await expect(documentsService.reviewDocument({
      documentId: DOCUMENT_ID,
      companyId: COMPANY_ID,
      status,
      reviewComment: '   ',
      reviewedBy: USER_ID
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'REVIEW_COMMENT_REQUIRED'
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('solo admite los tres estados de revisión del contrato', async () => {
    await expect(documentsService.reviewDocument({
      documentId: DOCUMENT_ID,
      companyId: COMPANY_ID,
      status: 'pending',
      reviewedBy: USER_ID
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'INVALID_DOCUMENT_STATUS'
    });
  });

  test('impide eliminar cuando canDelete es falso', async () => {
    query.mockResolvedValueOnce({ rows: [documentRow({ status: 'approved' })] });

    await expect(documentsService.deleteDocument({
      documentId: DOCUMENT_ID,
      companyId: COMPANY_ID,
      deletedBy: USER_ID
    })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'DOCUMENT_NOT_DELETABLE'
    });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test('devuelve exactamente el catálogo solicitado por el frontend', async () => {
    await expect(documentsService.getDocumentTypes(COMPANY_ID)).resolves.toEqual([
      'DNI',
      'CV',
      'MEDICAL_CERTIFICATE',
      'BACKGROUND_CHECK',
      'STUDIES_CERTIFICATE'
    ]);
  });
});
