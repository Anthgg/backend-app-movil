const analytics = require('../../src/services/attendance-service/services/analytics.service');

function row(overrides = {}) {
  return {
    workerId: '11111111-1111-4111-8111-111111111111',
    userId: '33333333-3333-4333-8333-333333333333',
    workerName: 'Trabajador de prueba',
    fullName: 'Trabajador de prueba',
    documentNumber: '70000001',
    profilePhotoUrl: 'https://cdn.example.com/profile.jpg',
    photoUrl: 'https://cdn.example.com/profile.jpg',
    avatarUrl: 'https://cdn.example.com/profile.jpg',
    date: '2026-06-01',
    areaId: '22222222-2222-4222-8222-222222222222',
    areaName: 'Produccion',
    departmentId: '44444444-4444-4444-8444-444444444444',
    departmentName: 'Operaciones',
    positionId: '55555555-5555-4555-8555-555555555555',
    positionName: 'Operario',
    workLocationId: '66666666-6666-4666-8666-666666666666',
    workLocationName: 'Obra Norte',
    crewId: '77777777-7777-4777-8777-777777777777',
    crewName: 'Cuadrilla A',
    checkIn: '2026-06-01T08:00:00.000Z',
    checkOut: '2026-06-01T17:00:00.000Z',
    latitude: -12.1,
    longitude: -77.1,
    evidencePhotoUrl: 'https://cdn.example.com/evidence.jpg',
    observation: null,
    scheduledDay: true,
    isHoliday: false,
    holidayName: null,
    shiftName: 'Turno día',
    attendanceRequired: true,
    hasAttendance: true,
    completedShift: true,
    isLate: false,
    status: 'present',
    workedMinutes: 480,
    lateMinutes: 0,
    overtimeMinutes: 0,
    ...overrides
  };
}

describe('Attendance analytics business metrics', () => {
  test('perfect attendance returns 100 percent and score 100', () => {
    const rows = Array.from({ length: 24 }, (_, index) => row({
      date: `2026-06-${String(index + 1).padStart(2, '0')}`
    }));

    const metrics = analytics.aggregateRows(rows);

    expect(metrics.presentCount).toBe(24);
    expect(metrics.onTimeCount).toBe(24);
    expect(metrics.attendanceRate).toBe(100);
    expect(metrics.punctualityRate).toBe(100);
    expect(metrics.absenceRate).toBe(0);
    expect(metrics.score).toBe(100);
  });

  test('late attendance remains present but reduces punctuality', () => {
    const rows = Array.from({ length: 22 }, (_, index) => row({
      date: `2026-06-${String(index + 1).padStart(2, '0')}`,
      status: index < 5 ? 'late' : 'present',
      isLate: index < 5,
      lateMinutes: index < 5 ? 10 : 0
    }));

    const metrics = analytics.aggregateRows(rows);

    expect(metrics.presentCount).toBe(22);
    expect(metrics.lateCount).toBe(5);
    expect(metrics.onTimeCount).toBe(17);
    expect(metrics.punctualityRate).toBeLessThan(100);
  });

  test.each([
    ['vacation', 'vacationCount'],
    ['medical_leave', 'medicalLeaveCount'],
    ['unpaid_leave', 'unpaidLeaveCount']
  ])('%s is counted separately and never as an absence', (status, counter) => {
    const metrics = analytics.aggregateRows([
      row({ status, attendanceRequired: false, hasAttendance: false, completedShift: false })
    ]);

    expect(metrics[counter]).toBe(1);
    expect(metrics.absentCount).toBe(0);
    expect(metrics.scheduledWorkDays).toBe(0);
  });

  test('zero denominators return finite zero rates', () => {
    const metrics = analytics.aggregateRows([
      row({ status: 'no_schedule', attendanceRequired: false, hasAttendance: false, completedShift: false })
    ]);

    expect(metrics.attendanceRate).toBe(0);
    expect(metrics.punctualityRate).toBe(0);
    expect(metrics.absenceRate).toBe(0);
    expect(metrics.lateRate).toBe(0);
    Object.values(metrics).forEach((value) => {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    });
  });

  test('area with most lates is ranked first and is chart-ready', () => {
    const production = analytics.aggregateRows([
      row({ isLate: true, status: 'late', lateMinutes: 15 }),
      row({ isLate: true, status: 'late', lateMinutes: 20, date: '2026-06-02' })
    ]);
    const warehouse = analytics.aggregateRows([
      row({ isLate: true, status: 'late', lateMinutes: 5 })
    ]);
    const rankings = analytics.buildRankings([], [
      { areaId: '1', areaName: 'Produccion', label: 'Produccion', ...production },
      { areaId: '2', areaName: 'Almacen', label: 'Almacen', ...warehouse }
    ], 10);

    expect(rankings.topLateAreas[0]).toMatchObject({
      rank: 1,
      label: 'Produccion',
      value: 2,
      lateCount: 2
    });
  });

  test('operational dimension rankings are sorted by backend', () => {
    const low = { label: 'Obra A', scheduledWorkDays: 10, absentCount: 1, absenceRate: 10, lateCount: 0, lateMinutes: 0, score: 90, attendanceRate: 90 };
    const high = { label: 'Obra B', scheduledWorkDays: 10, absentCount: 3, absenceRate: 30, lateCount: 2, lateMinutes: 40, score: 60, attendanceRate: 70 };

    const rankings = analytics.buildDimensionRankings([low, high], 10);

    expect(rankings.topAbsences[0]).toMatchObject({ rank: 1, label: 'Obra B', value: 3 });
    expect(rankings.topLates[0]).toMatchObject({ rank: 1, label: 'Obra B', value: 2 });
    expect(rankings.bestAttendance[0]).toMatchObject({ rank: 1, label: 'Obra A', value: 90 });
  });

  test('daily trend includes dates without rows and weekly trend remains finite', () => {
    const period = { startDate: '2026-06-01', endDate: '2026-06-08', month: '2026-06' };
    const daily = analytics.buildDailyTrend([row()], period);
    const weekly = analytics.buildWeeklyTrend(daily, period);

    expect(daily).toHaveLength(8);
    expect(daily[1]).toMatchObject({ key: '2026-06-02', date: '2026-06-02', label: '02 Jun', presentCount: 0, attendanceRate: 0 });
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toMatchObject({ key: 'week-1', label: 'Semana 1' });
    expect(weekly.every((item) => Number.isFinite(item.attendanceRate))).toBe(true);
  });

  test('worker rankings include drawer and avatar fields', () => {
    const workers = analytics.workerSummaries([
      row({ status: 'late', isLate: true, lateMinutes: 12 }),
      row({ date: '2026-06-02', status: 'absent', hasAttendance: false, completedShift: false })
    ]);

    const rankings = analytics.buildRankings(workers, [], 10);

    expect(rankings.topAbsentWorkers[0]).toMatchObject({
      workerId: '11111111-1111-4111-8111-111111111111',
      userId: '33333333-3333-4333-8333-333333333333',
      label: 'Trabajador de prueba',
      fullName: 'Trabajador de prueba',
      documentNumber: '70000001',
      profilePhotoUrl: 'https://cdn.example.com/profile.jpg',
      avatarUrl: 'https://cdn.example.com/profile.jpg',
      lastAbsenceAt: '2026-06-02'
    });
    expect(rankings.bestPunctualityWorkers).toHaveLength(1);
  });

  test('table response is paginated, searchable and sorted by backend', () => {
    const dataset = {
      period: { startDate: '2026-06-01', endDate: '2026-06-30', month: '2026-06' },
      filters: {},
      rows: [
        row({ workerId: '11111111-1111-4111-8111-111111111111', workerName: 'Ana Lopez', fullName: 'Ana Lopez', documentNumber: '70000001' }),
        row({ workerId: '22222222-2222-4222-8222-222222222222', userId: '88888888-8888-4888-8888-888888888888', workerName: 'Bruno Diaz', fullName: 'Bruno Diaz', documentNumber: '70000002', lateMinutes: 30, isLate: true, status: 'late' })
      ],
      allRows: []
    };

    const table = analytics.buildTableResponse(dataset, {
      search: 'bruno',
      page: 1,
      pageSize: 10,
      sortBy: 'lateMinutes',
      sortDirection: 'desc'
    });

    expect(table).toMatchObject({ period: '2026-06', total: 1, page: 1, pageSize: 10 });
    expect(table.items[0]).toMatchObject({
      fullName: 'Bruno Diaz',
      attendedDays: 1,
      lateDays: 1,
      lateMinutes: 30
    });
  });

  test('worker drawer response returns summary and real calendar DTO', () => {
    const workerId = '11111111-1111-4111-8111-111111111111';
    const dataset = {
      period: { startDate: '2026-06-01', endDate: '2026-06-02', month: '2026-06' },
      filters: { workerId },
      rows: [
        row({ date: '2026-06-01', status: 'present' }),
        row({ date: '2026-06-02', status: 'medical_leave', attendanceRequired: false, hasAttendance: false, completedShift: false, checkIn: null, checkOut: null })
      ],
      allRows: [
        row({ date: '2026-06-01', status: 'present' }),
        row({ date: '2026-06-02', status: 'medical_leave', attendanceRequired: false, hasAttendance: false, completedShift: false, checkIn: null, checkOut: null })
      ]
    };

    const detail = analytics.buildWorkerDetailResponse(dataset, workerId);

    expect(detail.worker).toMatchObject({
      workerId,
      fullName: 'Trabajador de prueba',
      currentStatus: 'MEDICAL_LEAVE',
      avatarUrl: 'https://cdn.example.com/profile.jpg'
    });
    expect(detail.summary).toMatchObject({ attendedDays: 1, medicalLeaveDays: 1, absentDays: 0 });
    expect(detail.calendar[1]).toMatchObject({
      date: '2026-06-02',
      status: 'MEDICAL_LEAVE',
      label: 'Descanso médico',
      isWorkingDay: true,
      shiftName: 'Turno día'
    });
  });

  test('aggregate drawer keeps leave states out of absences', () => {
    const areaId = '22222222-2222-4222-8222-222222222222';
    const dataset = {
      period: { startDate: '2026-06-01', endDate: '2026-06-03', month: '2026-06' },
      filters: { areaId },
      rows: [
        row({ date: '2026-06-01', status: 'vacation', attendanceRequired: false, hasAttendance: false, completedShift: false }),
        row({ date: '2026-06-02', status: 'unpaid_leave', attendanceRequired: false, hasAttendance: false, completedShift: false }),
        row({ date: '2026-06-03', status: 'absent', hasAttendance: false, completedShift: false })
      ],
      allRows: []
    };

    const detail = analytics.buildAggregateDetailResponse(dataset, 'area', areaId, 10);

    expect(detail.entity).toEqual({ id: areaId, name: 'Produccion', type: 'area' });
    expect(detail.summary).toMatchObject({
      vacationCount: 1,
      unpaidLeaveCount: 1,
      absentCount: 1
    });
    expect(detail.statusDistribution.find((item) => item.key === 'vacation').value).toBe(1);
  });

  test('export row builders produce downloadable table data', () => {
    const dashboardRows = analytics.dashboardToExportRows({
      kpis: { totalWorkers: 1, attendanceRate: 100 },
      charts: { statusDistribution: [{ key: 'present', label: 'Asistió', value: 1, percentage: 100 }] },
      rankings: { topAbsentWorkers: [], topLateWorkers: [], bestAttendanceWorkers: [] }
    });
    const workerRows = analytics.workerDetailToExportRows({
      worker: { workerId: '11111111-1111-4111-8111-111111111111', fullName: 'Ana', documentNumber: '70000001' },
      calendar: [{ date: '2026-06-01', status: 'PRESENT', label: 'Asistió', checkIn: null, checkOut: null, lateMinutes: 0, workedMinutes: 480, locationName: 'Obra', shiftName: 'Turno' }]
    });

    expect(dashboardRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'KPIs', metric: 'Trabajadores', value: 1 })
    ]));
    expect(workerRows[0]).toMatchObject({ fullName: 'Ana', status: 'PRESENT', workedMinutes: 480 });
  });

  test('period and status filters accept both API naming styles', () => {
    expect(analytics.parsePeriod({ start_date: '2026-06-01', end_date: '2026-06-15' })).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-15',
      month: '2026-06'
    });
    expect(analytics.normalizeStatuses('PRESENT,descanso medico,PERMISO_PERSONAL')).toEqual([
      'present', 'medical_leave', 'unpaid_leave'
    ]);
  });

  test('invalid UUID filter values fail before querying PostgreSQL', () => {
    expect(() => analytics.validateUuid('not-a-uuid', 'workerId')).toThrow('workerId');
  });

  test('all public analytics routes are registered', () => {
    const router = require('../../src/services/attendance-service/routes/attendance.routes');
    const paths = router.stack.map((layer) => layer.route?.path).filter(Boolean);

    expect(paths).toEqual(expect.arrayContaining([
      '/analytics/today',
      '/analytics/monthly',
      '/analytics/table',
      '/analytics/workers',
      '/analytics/workers/:workerId/summary',
      '/analytics/workers/:workerId',
      '/analytics/areas',
      '/analytics/areas/:areaId',
      '/analytics/departments',
      '/analytics/work-locations',
      '/analytics/work-locations/:workLocationId',
      '/analytics/crews',
      '/analytics/crews/:crewId',
      '/analytics/trends/daily',
      '/analytics/trends/weekly',
      '/analytics/rankings/absences',
      '/analytics/rankings/lates',
      '/analytics/rankings/best-attendance',
      '/analytics/rankings/areas/absences',
      '/analytics/rankings/areas/lates',
      '/analytics/rankings/work-locations/absences',
      '/analytics/rankings/work-locations/lates',
      '/analytics/rankings/work-locations/best-attendance',
      '/analytics/rankings/crews/absences',
      '/analytics/rankings/crews/lates',
      '/analytics/rankings/crews/best-attendance',
      '/analytics/kpis',
      '/analytics/dashboard',
      '/analytics/export/filters',
      '/analytics/export',
      '/analytics/recalculate'
    ]));
  });
});
