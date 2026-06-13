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
});
