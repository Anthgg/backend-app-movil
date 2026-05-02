// src/shared/utils/attendanceCalculations.js
const moment = require('moment');

function calculateLateMinutes(checkInTimeStr, shiftStartTimeStr, toleranceMinutes) {
  // Simplificado para ejemplo
  const checkIn = moment(checkInTimeStr, 'HH:mm:ss');
  const shiftStart = moment(shiftStartTimeStr, 'HH:mm:ss');
  const limit = shiftStart.clone().add(toleranceMinutes, 'minutes');

  if (checkIn.isAfter(limit)) {
    return checkIn.diff(shiftStart, 'minutes');
  }
  return 0;
}

function calculateWorkedHours(checkInTimeStr, checkOutTimeStr) {
  if (!checkInTimeStr || !checkOutTimeStr) return 0;
  const start = moment(checkInTimeStr);
  const end = moment(checkOutTimeStr);
  return end.diff(start, 'hours', true).toFixed(2);
}

module.exports = {
  calculateLateMinutes,
  calculateWorkedHours
};
