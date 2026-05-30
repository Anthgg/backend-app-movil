function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some((value) => Number.isNaN(value))) return null;

  const [fromLat, fromLon, toLat, toLon] = values;
  const R = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;

  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(fromLat)) *
    Math.cos(toRad(toLat)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function isWithinAllowedRadius(workerLat, workerLon, placeLat, placeLon, allowedRadius = 100) {
  const distance = calculateDistanceMeters(workerLat, workerLon, placeLat, placeLon);
  if (distance === null) return { isWithin: false, distance: null };
  return { isWithin: distance <= Number(allowedRadius || 100), distance };
}

function validateCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return !Number.isNaN(lat)
    && !Number.isNaN(lon)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180;
}

function validateGpsAccuracy(gpsAccuracy, maxAccuracy = 100) {
  if (gpsAccuracy === undefined || gpsAccuracy === null || gpsAccuracy === '') return true;
  const accuracy = Number(gpsAccuracy);
  return !Number.isNaN(accuracy) && accuracy <= maxAccuracy;
}

function detectMockLocation(isMockLocation) {
  return isMockLocation === true || isMockLocation === 'true';
}

module.exports = {
  calculateDistanceMeters,
  isWithinAllowedRadius,
  validateCoordinates,
  validateGpsAccuracy,
  detectMockLocation
};
