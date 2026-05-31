const { formatDateTimeParts, TIMEZONE } = require('../../src/services/report-service/utils/workCrewReportFormatter');

describe('work crew report date/time formatter', () => {
  test('separa un datetime valido en fecha y hora para America/Lima', () => {
    const result = formatDateTimeParts('2026-05-31T14:30:00Z');

    expect(result).toEqual({
      date: '31/05/2026',
      time: '09:30'
    });
  });

  test('devuelve guiones para null y undefined', () => {
    expect(formatDateTimeParts(null)).toEqual({ date: '-', time: '-' });
    expect(formatDateTimeParts(undefined)).toEqual({ date: '-', time: '-' });
  });

  test('convierte UTC a la zona horaria configurada de Peru/Lima', () => {
    const result = formatDateTimeParts(new Date('2026-01-01T03:15:00Z'));

    expect(TIMEZONE).toBe('America/Lima');
    expect(result).toEqual({
      date: '31/12/2025',
      time: '22:15'
    });
  });

  test('para fechas sin hora conserva la fecha y deja hora como guion', () => {
    expect(formatDateTimeParts('2026-06-02')).toEqual({
      date: '02/06/2026',
      time: '-'
    });
  });
});
