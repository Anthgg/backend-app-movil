const moment = require('moment-timezone');

const TIMEZONE = 'America/Lima';
const EMPTY_VALUE = '-';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatDateTimeParts(value, timezone = TIMEZONE) {
  if (value === null || value === undefined || value === '') {
    return { date: EMPTY_VALUE, time: EMPTY_VALUE };
  }

  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) {
    const parsedDate = moment.tz(value, 'YYYY-MM-DD', true, timezone);
    return {
      date: parsedDate.isValid() ? parsedDate.format('DD/MM/YYYY') : EMPTY_VALUE,
      time: EMPTY_VALUE
    };
  }

  const parsed = moment(value);
  if (!parsed.isValid()) {
    return { date: EMPTY_VALUE, time: EMPTY_VALUE };
  }

  const zoned = parsed.tz(timezone);
  return {
    date: zoned.format('DD/MM/YYYY'),
    time: zoned.format('HH:mm')
  };
}

module.exports = {
  TIMEZONE,
  EMPTY_VALUE,
  formatDateTimeParts
};
