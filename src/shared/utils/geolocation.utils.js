/**
 * Funciones de utilidad para geolocalización
 */

// Calcula la distancia en metros entre dos coordenadas (Haversine formula)
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371e3; // Radio de la tierra en metros
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function isWithinAllowedRadius(workerLat, workerLon, projectLat, projectLon, allowedRadius = 100) {
  const distance = calculateDistanceMeters(workerLat, workerLon, projectLat, projectLon);
  if (distance === null) return { isWithin: false, distance: null };
  return { isWithin: distance <= allowedRadius, distance };
}

function validateCoordinates(latitude, longitude) {
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function validateGpsAccuracy(gpsAccuracy, maxAccuracy = 50) {
  // Retorna false si la precision es muy mala (>50 metros por defecto)
  return gpsAccuracy <= maxAccuracy;
}

function detectMockLocation(isMockLocation) {
  return isMockLocation === true;
}

module.exports = {
  calculateDistanceMeters,
  isWithinAllowedRadius,
  validateCoordinates,
  validateGpsAccuracy,
  detectMockLocation
};
