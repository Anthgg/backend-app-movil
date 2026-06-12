const env = require('../../config/env');
const { isPrivateIp } = require('./device-parser');

const cache = new Map();

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildLocation(city, country) {
  return [city, country].filter(Boolean).join(', ') || null;
}

function normalizeGeoPayload(payload = {}) {
  if (!payload || payload.status === 'fail') return null;

  const country = payload.country || payload.country_name || null;
  const city = payload.city || null;
  const latitude = toNumber(payload.lat ?? payload.latitude);
  const longitude = toNumber(payload.lon ?? payload.lng ?? payload.longitude);

  return {
    country,
    city,
    location: payload.location || buildLocation(city, country),
    latitude,
    longitude
  };
}

function emptyGeo() {
  return {
    country: null,
    city: null,
    location: null,
    latitude: null,
    longitude: null
  };
}

async function fetchWithTimeout(url, timeoutMs) {
  if (typeof fetch !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveIpLocation(ip) {
  if (!env.ipGeolocationEnabled || !ip || isPrivateIp(ip)) {
    return emptyGeo();
  }

  const now = Date.now();
  const cached = cache.get(ip);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const template = env.ipGeolocationProviderUrl || 'http://ip-api.com/json/{ip}?fields=status,country,city,lat,lon,message';
  const url = template.replace('{ip}', encodeURIComponent(ip));
  const payload = await fetchWithTimeout(url, env.ipGeolocationTimeoutMs);
  const value = normalizeGeoPayload(payload) || emptyGeo();

  cache.set(ip, {
    value,
    expiresAt: now + env.ipGeolocationCacheTtlMs
  });

  return value;
}

function clearIpLocationCache() {
  cache.clear();
}

module.exports = {
  resolveIpLocation,
  normalizeGeoPayload,
  clearIpLocationCache,
  emptyGeo
};
