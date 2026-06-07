const report = require('../../src/services/report-service/services/workerLocationHistoryReport.service');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';

function createWorker(overrides = {}) {
  return {
    worker_id: WORKER_ID,
    full_name: 'Jesus Anthony Garamendi Gonzales',
    document_number: '71372527',
    personal_id: '71372527',
    position_name: 'Supervisor',
    area_name: 'Operaciones',
    internal_department_name: 'Logistica',
    company_name: 'FABRYOR',
    razon_social: 'FABRYOR S.A.C.',
    nombre_comercial: 'FABRYOR',
    ruc: '20605153136',
    direccion_fiscal: 'Lima, Peru',
    logo_url: null,
    firma_url: null,
    sello_url: null,
    representante_legal: 'Luciano Parvina Edgar Vicente',
    cargo_representante: 'Representante Legal',
    color_primario: '#1e3a8a',
    color_secundario: '#3b82f6',
    color_texto: '#0f172a',
    current_work_location_name: 'Obra Norte',
    current_crew_name: 'Cuadrilla Principal',
    status: 'active',
    ...overrides
  };
}

function createFakeDb({ worker = createWorker(), movements = [] } = {}) {
  return {
    query: jest.fn(async (sql, params) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            'company_id',
            'razon_social',
            'nombre_comercial',
            'ruc',
            'direccion_fiscal',
            'telefono',
            'correo_corporativo',
            'pagina_web',
            'logo_url',
            'firma_url',
            'sello_url',
            'representante_legal',
            'cargo_representante',
            'color_primario',
            'color_secundario',
            'color_texto'
          ].map((column_name) => ({ column_name })),
          rowCount: 16
        };
      }

      if (sql.includes('FROM workers w')) {
        return worker ? { rows: [worker], rowCount: 1 } : { rows: [], rowCount: 0 };
      }

      if (sql.includes('FROM worker_assignment_history wah')) {
        return { rows: movements, rowCount: movements.length };
      }

      throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
    })
  };
}

const adminUser = {
  id: '33333333-3333-4333-8333-333333333333',
  company_id: COMPANY_ID,
  roles: ['ADMIN'],
  permissions: []
};

describe('worker location history PDF report', () => {
  test('rejects invalid worker IDs before querying the database', async () => {
    const db = createFakeDb();

    await expect(report.generateWorkerLocationHistoryPdf({
      workerId: 'PENDIENTE-123',
      companyId: COMPANY_ID,
      currentUser: adminUser,
      dbClient: db
    })).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_WORKER_ID'
    });

    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects invalid date ranges', async () => {
    await expect(report.generateWorkerLocationHistoryPdf({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      currentUser: adminUser,
      startDate: '2026-06-30',
      endDate: '2026-06-01',
      dbClient: createFakeDb()
    })).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_DATE_RANGE'
    });
  });

  test('rejects users without report permissions', async () => {
    await expect(report.generateWorkerLocationHistoryPdf({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      currentUser: {
        id: '44444444-4444-4444-8444-444444444444',
        company_id: COMPANY_ID,
        roles: ['TRABAJADOR'],
        permissions: []
      },
      dbClient: createFakeDb()
    })).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'REPORT_FORBIDDEN'
    });
  });

  test('returns WORKER_NOT_FOUND when the worker does not belong to the tenant', async () => {
    await expect(report.generateWorkerLocationHistoryPdf({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      currentUser: adminUser,
      dbClient: createFakeDb({ worker: null })
    })).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'WORKER_NOT_FOUND'
    });
  });

  test('generates a valid PDF with movements and date filters', async () => {
    const db = createFakeDb({
      movements: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          worker_id: WORKER_ID,
          changed_at: '2026-06-10T13:30:00.000Z',
          change_type: 'worker_moved_crew',
          previous_work_location_name: 'Obra Norte',
          new_work_location_name: 'Obra Sur',
          previous_crew_name: 'Cuadrilla A',
          new_crew_name: 'Cuadrilla B',
          reason: 'Apoyo temporal',
          status: null,
          changed_by_name: 'Usuario Admin QA'
        }
      ]
    });

    const result = await report.generateWorkerLocationHistoryPdf({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      currentUser: { ...adminUser, permissions: ['reports.workers.read'] },
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      dbClient: db,
      generatedAt: new Date('2026-06-10T14:35:00.000Z')
    });

    expect(result.filename).toBe(`historial_movimientos_71372527_${WORKER_ID}.pdf`);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.slice(0, 4).toString()).toBe('%PDF');

    const historyCall = db.query.mock.calls.find(([sql]) => sql.includes('FROM worker_assignment_history wah'));
    expect(historyCall[1]).toEqual([WORKER_ID, COMPANY_ID, '2026-06-01', '2026-06-30']);
  });

  test('generates a valid PDF when the worker has no movements', async () => {
    const result = await report.generateWorkerLocationHistoryPdf({
      workerId: WORKER_ID,
      companyId: COMPANY_ID,
      currentUser: adminUser,
      dbClient: createFakeDb({ movements: [] })
    });

    expect(result.buffer.slice(0, 4).toString()).toBe('%PDF');
  });

  test('formats movement labels and details for display', () => {
    expect(report.formatMovementType('worker_added_to_crew')).toBe('Ingreso a cuadrilla');
    expect(report.formatMovementType('unknown_code')).toBe('Movimiento registrado');
    expect(report.buildMovementDetails({
      previous_work_location_name: 'Obra Norte',
      new_work_location_name: 'Obra Sur',
      previous_crew_name: 'Cuadrilla A',
      new_crew_name: 'Cuadrilla B'
    })).toBe('Obra Norte -> Obra Sur / Cuadrilla A -> Cuadrilla B');
  });

  test('uses a registered status when movement status is missing', () => {
    const payload = report.buildWorkerLocationHistoryCorporatePayload({
      worker: createWorker(),
      movements: [{
        changed_at: '2026-06-10T13:30:00.000Z',
        change_type: 'worker_added_to_crew',
        new_work_location_name: 'Obra Norte',
        new_crew_name: 'Cuadrilla Principal',
        reason: 'Asignacion inicial',
        status: null,
        changed_by_name: 'Usuario Admin QA'
      }],
      currentUser: adminUser,
      generatedAt: new Date('2026-06-10T14:35:00.000Z')
    });

    expect(payload.rows[0].status).toBe('Registrado');
  });

  test('builds the official corporate PDF payload', () => {
    const payload = report.buildWorkerLocationHistoryCorporatePayload({
      worker: createWorker({
        firma_url: 'https://example.test/firma.png',
        sello_url: 'https://example.test/sello.png'
      }),
      movements: [{
        changed_at: '2026-06-10T13:30:00.000Z',
        change_type: 'worker_moved_crew',
        previous_work_location_name: 'Obra Norte',
        new_work_location_name: 'Obra Sur',
        previous_crew_name: 'Cuadrilla A',
        new_crew_name: 'Cuadrilla B',
        reason: 'Apoyo temporal',
        assignment_type: 'temporary',
        changed_by_name: 'Usuario Admin QA'
      }],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      currentUser: adminUser,
      generatedAt: new Date('2026-06-10T14:35:00.000Z')
    });

    expect(payload.reportTitle).toBe('HISTORIAL DE MOVIMIENTOS Y ASIGNACIONES');
    expect(payload.internalLabel).toBe('F-RRHH-10');
    expect(payload.companyConfig.legalName).toBe('FABRYOR S.A.C.');
    expect(payload.companyConfig.signatureUrl).toBe('https://example.test/firma.png');
    expect(payload.companyConfig.stampUrl).toBe('https://example.test/sello.png');
    expect(payload.showSummaryCards).toBe(false);
    expect(payload.signatureMode).toBe('fixed');
    expect(payload.summary).toBeNull();
    expect(payload.infoSectionsLayout).toBe('combined-two-column');
    expect(payload.infoSections.map((section) => section.title)).toEqual([
      'INFORMACION DEL REPORTE',
      'DATOS DEL TRABAJADOR'
    ]);
    expect(payload.infoSections[0].rows).toEqual([
      { label: 'Tipo de documento', value: 'Documento interno' },
      { label: 'Codigo interno', value: 'F-RRHH-10' },
      { label: 'Fecha de generacion', value: '10/06/2026 09:35' },
      { label: 'Generado por', value: 'Sistema' },
      { label: 'Periodo consultado', value: '01/06/2026 al 30/06/2026' },
      { label: 'Total movimientos', value: 1 }
    ]);
    expect(payload.infoSections[1].rows).toEqual([
      { label: 'Trabajador', value: 'Jesus Anthony Garamendi Gonzales' },
      { label: 'DNI', value: '71372527' }
    ]);
    expect(payload.columns.map((column) => column.key)).toEqual([
      'movement_date',
      'movement_type',
      'detail',
      'reason',
      'status',
      'changed_by_name'
    ]);
    expect(payload.rows[0]).toMatchObject({
      movement_type: 'Cambio de cuadrilla',
      detail: 'Obra Norte -> Obra Sur / Cuadrilla A -> Cuadrilla B',
      reason: 'Apoyo temporal',
      status: 'Temporal',
      changed_by_name: 'Usuario Admin QA'
    });
  });
});
