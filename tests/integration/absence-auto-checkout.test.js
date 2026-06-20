jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/shared/utils/logger', () => ({
  logInfo: jest.fn(),
  logChange: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../src/services/schedule-service/services/laborSchedule.service', () => {
  const moment = require('moment-timezone');

  return {
    getPolicy: jest.fn().mockResolvedValue({
      id: 'policy-id',
      timezone: 'America/Lima',
      autoAbsenceEnabled: true
    }),
    normalizeDate: jest.fn((value) => {
      if (typeof value === 'string') return value.slice(0, 10);
      return moment(value).tz('America/Lima').format('YYYY-MM-DD');
    }),
    buildShiftMoments: jest.fn((dateValue, shift, timezone = 'America/Lima') => {
      const date = typeof dateValue === 'string'
        ? dateValue.slice(0, 10)
        : moment(dateValue).tz(timezone).format('YYYY-MM-DD');
      const scheduledCheckIn = moment.tz(`${date} ${shift.startTime}`, 'YYYY-MM-DD HH:mm:ss', timezone);
      const scheduledCheckOut = moment.tz(`${date} ${shift.endTime}`, 'YYYY-MM-DD HH:mm:ss', timezone);
      if (scheduledCheckOut.isSameOrBefore(scheduledCheckIn)) scheduledCheckOut.add(1, 'day');
      return { scheduledCheckIn, scheduledCheckOut };
    }),
    resolveWorkerSchedule: jest.fn(),
    calculateAttendanceMetrics: jest.fn()
  };
});

const { query } = require('../../src/config/database');
const scheduleService = require('../../src/services/schedule-service/services/laborSchedule.service');
const absenceService = require('../../src/services/attendance-service/services/absence.service');

describe('automatic attendance closing', () => {
  beforeEach(() => {
    query.mockReset();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('closes an overdue night shift using shifts and its scheduled end', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'attendance-id',
          date: '2026-06-19',
          status: 'incomplete',
          check_in_time: '2026-06-20T04:07:47.000Z',
          scheduled_check_in: '23:00:00',
          scheduled_check_out: '05:00:00',
          start_time: '23:00:00',
          end_time: '05:00:00',
          timezone: 'America/Lima'
        }]
      })
      .mockResolvedValueOnce({ rows: [{ id: 'attendance-id' }] });
    const recalculate = jest
      .spyOn(absenceService, 'recalculateDailyAttendance')
      .mockResolvedValue({ success: true });

    const result = await absenceService.processAutoCheckouts('company-id', {
      now: '2026-06-20T06:00:00-05:00'
    });

    expect(result.closedCount).toBe(1);
    expect(query.mock.calls[0][0]).toContain('LEFT JOIN shifts');
    expect(query.mock.calls[0][0]).not.toContain('labor_schedules');
    expect(query.mock.calls[1][1][0]).toBe('2026-06-20 05:00:00-05:00');
    expect(query.mock.calls[1][1][1]).toBe(352);
    expect(recalculate).toHaveBeenCalledWith('company-id', '2026-06-19', null);
  });

  test('does not close a night shift at 23:59 before its next-day end', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'attendance-id',
          date: '2026-06-19',
          start_time: '23:00:00',
          end_time: '05:00:00',
          timezone: 'America/Lima'
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await absenceService.closeIncompleteAttendances(
      'company-id',
      '2026-06-19',
      null,
      { now: '2026-06-19T23:59:00-05:00' }
    );

    expect(result.closedCount).toBe(0);
    expect(query.mock.calls.some(([sql]) => /UPDATE\s+attendance_records/i.test(sql))).toBe(false);
  });

  test('does not generate yesterday absence while its night shift is active', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-20T05:00:00.000Z'));
    scheduleService.resolveWorkerSchedule.mockResolvedValue({
      isWorkingDay: true,
      shift: {
        id: 'shift-id',
        startTime: '23:00:00',
        endTime: '05:00:00',
        timezone: 'America/Lima'
      },
      policy: {
        id: 'policy-id',
        timezone: 'America/Lima'
      }
    });
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'worker-id',
          user_id: 'user-id',
          company_id: 'company-id',
          user_active: true,
          hire_date: null,
          contract_end_date: null
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await absenceService.generateDailyAbsences('company-id', '2026-06-19');

    expect(result.absencesGenerated).toBe(0);
    expect(query.mock.calls.some(([sql]) => /INSERT\s+INTO\s+attendance_records/i.test(sql))).toBe(false);
  });
});
