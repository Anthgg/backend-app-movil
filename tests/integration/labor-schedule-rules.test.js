const scheduleService = require('../../src/services/schedule-service/services/laborSchedule.service');

describe('Labor schedule rule helpers', () => {
  test('calculates effective minutes for a 9-hour presence shift with unpaid break', () => {
    const effective = scheduleService.calculateEffectiveMinutes('08:00', '17:00', 60, false);
    expect(effective).toBe(480);
  });

  test('calculates effective minutes for an 8-hour continuous shift without break', () => {
    const effective = scheduleService.calculateEffectiveMinutes('08:00', '16:00', 0, false);
    expect(effective).toBe(480);
  });

  test('marks 08:05 inside tolerance and 08:06 as late for an 08:00 shift', () => {
    const schedule = {
      date: '2026-06-13',
      policy: {
        id: 'policy-id',
        lateToleranceMinutes: 5,
        defaultEffectiveMinutes: 480,
        timezone: 'America/Lima'
      },
      shift: {
        id: 'shift-id',
        startTime: '08:00',
        endTime: '17:00',
        toleranceMinutes: 5,
        effectiveMinutes: 480,
        breakMinutes: 60,
        breakPaid: false,
        timezone: 'America/Lima'
      },
      expectedMinutes: 480
    };

    const withinTolerance = scheduleService.calculateAttendanceMetrics({
      schedule,
      now: '2026-06-13T13:05:00.000Z',
      status: 'present'
    });
    const late = scheduleService.calculateAttendanceMetrics({
      schedule,
      now: '2026-06-13T13:06:00.000Z',
      status: 'present'
    });

    expect(withinTolerance.status).toBe('present');
    expect(withinTolerance.lateMinutes).toBe(0);
    expect(late.status).toBe('late');
    expect(late.lateMinutes).toBe(6);
  });

  test('normalizes spanish and english working day names', () => {
    const days = scheduleService.parseWorkingDays(['Lunes', 'Tue', 'sabado', 'Sunday']);
    expect(days).toEqual(['monday', 'tuesday', 'saturday', 'sunday']);
  });

  test('normalizes numeric working days for web payloads', () => {
    const normalized = scheduleService.normalizeWorkingDays([1, '2', 5, 'domingo']);

    expect(normalized).toEqual({
      numbers: [1, 2, 5, 7],
      names: ['monday', 'tuesday', 'friday', 'sunday']
    });
    expect(scheduleService.parseWorkingDays([1, 2, 3, 4, 5])).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday'
    ]);
  });

  test('maps shifts with numeric workingDays and named workingDaysNames', () => {
    const shift = scheduleService.mapShift({
      id: '11111111-1111-4111-8111-111111111111',
      company_id: '33333333-3333-4333-8333-333333333333',
      name: 'Turno Test Lunes a Viernes',
      start_time: '07:00',
      end_time: '16:00',
      tolerance_minutes: 10,
      break_minutes: 60,
      break_paid: false,
      weekly_target_minutes: 2400,
      working_days: JSON.stringify([1, 2, 3, 4, 5]),
      timezone: 'America/Lima',
      allows_overtime: true,
      is_active: true
    }, {
      workingDaysNames: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      timezone: 'America/Lima'
    });

    expect(shift).toMatchObject({
      workingDays: [1, 2, 3, 4, 5],
      workingDaysNames: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      working_days_numbers: [1, 2, 3, 4, 5]
    });
  });

  test('resolves worker schedule from active assignment and reflects edited shift days', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'policy-id',
            working_days: JSON.stringify(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
            timezone: 'America/Lima',
            late_tolerance_minutes: 10,
            default_effective_minutes: 480
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            company_id: '33333333-3333-4333-8333-333333333333',
            name: 'Turno Test Lunes a Viernes',
            start_time: '07:00',
            end_time: '16:00',
            tolerance_minutes: 10,
            break_minutes: 60,
            break_paid: false,
            weekly_target_minutes: 2400,
            working_days: JSON.stringify([1, 2, 3, 4, 5]),
            timezone: 'America/Lima',
            allows_overtime: true,
            is_active: true,
            status: 'active',
            assignment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            effective_from: '2026-06-15',
            effective_to: null,
            assigned_at: '2026-06-15T00:00:00.000Z',
            assignment_source: 'worker_shift_assignments'
          }]
        })
    };

    const schedule = await scheduleService.resolveWorkerScheduleForDate({
      companyId: '33333333-3333-4333-8333-333333333333',
      workerId: '99999999-9999-4999-8999-999999999999',
      date: '2026-06-16',
      client
    });

    expect(schedule).toMatchObject({
      date: '2026-06-16',
      source: 'assignment',
      dayOfWeek: 2,
      dayName: 'tuesday',
      isWorkingDay: true,
      assignment: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        startDate: '2026-06-15',
        endDate: null
      },
      shift: {
        id: '11111111-1111-4111-8111-111111111111',
        workingDays: [1, 2, 3, 4, 5],
        workingDaysNames: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      }
    });
  });
});
