const analytics = require('../../src/services/attendance-service/services/analytics.service');

function row(overrides = {}) {
  return {
    workerId: '11111111-1111-4111-8111-111111111111',
    workerName: 'Trabajador de prueba',
    date: '2026-06-01',
    areaId: '22222222-2222-4222-8222-222222222222',
    areaName: 'Produccion',
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
    expect(daily[1]).toMatchObject({ date: '2026-06-02', presentCount: 0, attendanceRate: 0 });
    expect(weekly).toHaveLength(2);
    expect(weekly.every((item) => Number.isFinite(item.attendanceRate))).toBe(true);
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
      '/analytics/workers',
      '/analytics/workers/:workerId/summary',
      '/analytics/areas',
      '/analytics/departments',
      '/analytics/work-locations',
      '/analytics/crews',
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
      '/analytics/recalculate'
    ]));
  });
});
