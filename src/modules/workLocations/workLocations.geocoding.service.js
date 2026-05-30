const axios = require('axios');
const { query } = require('../../config/database');
const { createHttpError } = require('../../shared/utils/http-error');

const NOMINATIM_URL = process.env.GEOCODING_BASE_URL || 'https://nominatim.openstreetmap.org';
const DEFAULT_LIMIT = 8;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(provincia|province|departamento|department|distrito|district)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getHeaders(req) {
  return {
    'User-Agent': process.env.GEOCODING_USER_AGENT || 'backend-rh-app/1.0',
    'Accept-Language': req?.headers?.['accept-language'] || 'es-PE,es;q=0.9,en;q=0.7'
  };
}

function getAddressLine(item) {
  const address = item.address || {};
  return [
    address.road,
    address.neighbourhood || address.suburb,
    address.city || address.town || address.village,
    address.state
  ].filter(Boolean).join(', ') || item.display_name;
}

function getUbigeoCandidates(address = {}) {
  return {
    department: [
      address.state,
      address.region
    ],
    province: [
      address.county,
      address.city,
      address.town,
      address.province,
      address.state_district
    ],
    district: [
      address.city_district,
      address.suburb,
      address.town,
      address.village,
      address.municipality,
      address.city
    ]
  };
}

function getDistrictCandidateGroups(address = {}) {
  return [
    [address.city_district],
    [address.suburb],
    [address.town, address.village, address.municipality],
    [address.city]
  ];
}

function normalizeCandidates(candidates) {
  return candidates
    .filter(Boolean)
    .map(normalizeText)
    .filter(Boolean);
}

async function getCatalogRows() {
  const res = await query(`
    SELECT
      gd.id AS department_id,
      gd.name AS department_name,
      gp.id AS province_id,
      gp.name AS province_name,
      gdi.id AS district_id,
      gdi.name AS district_name
    FROM geographic_districts gdi
    JOIN geographic_provinces gp ON gp.id = gdi.province_id
    JOIN geographic_departments gd ON gd.id = gp.department_id
    WHERE gdi.deleted_at IS NULL
      AND gp.deleted_at IS NULL
      AND gd.deleted_at IS NULL
      AND COALESCE(gdi.status, TRUE) = TRUE
      AND COALESCE(gp.status, TRUE) = TRUE
      AND COALESCE(gd.status, TRUE) = TRUE
  `);
  return res.rows;
}

function candidateMatches(value, candidates) {
  const normalizedValue = normalizeText(value);
  return normalizeCandidates(candidates)
    .some((candidate) => candidate === normalizedValue || candidate.includes(normalizedValue) || normalizedValue.includes(candidate));
}

function candidateMatchesExact(value, candidates) {
  const normalizedValue = normalizeText(value);
  return normalizeCandidates(candidates)
    .some((candidate) => candidate === normalizedValue);
}

async function matchUbigeo(address = {}) {
  const candidates = getUbigeoCandidates(address);
  const rows = await getCatalogRows();

  const scopedRows = rows.filter((row) => (
    candidateMatches(row.department_name, candidates.department)
    && candidateMatches(row.province_name, candidates.province)
  ));

  let exact = null;
  for (const districtCandidates of getDistrictCandidateGroups(address)) {
    exact = scopedRows.find((row) => candidateMatchesExact(row.district_name, districtCandidates));
    if (exact) break;
  }

  const partial = exact || rows.find((row) => (
    candidateMatches(row.department_name, candidates.department)
    && candidateMatches(row.province_name, candidates.province)
  )) || rows.find((row) => candidateMatches(row.department_name, candidates.department));

  if (!partial) return null;

  return {
    geographic_department_id: partial.department_id,
    geographic_department_name: partial.department_name,
    department_id: partial.department_id,
    department_name: partial.department_name,
    geographic_province_id: exact ? partial.province_id : null,
    geographic_province_name: exact ? partial.province_name : null,
    province_id: exact ? partial.province_id : null,
    province_name: exact ? partial.province_name : null,
    geographic_district_id: exact ? partial.district_id : null,
    geographic_district_name: exact ? partial.district_name : null,
    district_id: exact ? partial.district_id : null,
    district_name: exact ? partial.district_name : null
  };
}

async function formatPlace(item) {
  const address = item.address || {};
  const ubigeo = await matchUbigeo(address);

  return {
    place_id: String(item.place_id || item.osm_id || ''),
    name: item.name || address.building || address.amenity || address.road || item.display_name,
    display_name: item.display_name,
    address: getAddressLine(item),
    latitude: toNumber(item.lat),
    longitude: toNumber(item.lon),
    source: 'nominatim',
    raw_address: address,
    ...ubigeo
  };
}

async function searchPlaces(filters = {}, req = null) {
  const q = String(filters.q || filters.query || '').trim();
  if (q.length < 3) {
    throw createHttpError(422, 'PLACE_QUERY_TOO_SHORT', 'Ingrese al menos 3 caracteres para buscar un lugar.');
  }

  const limit = Math.min(Math.max(Number(filters.limit || DEFAULT_LIMIT), 1), 20);
  const res = await axios.get(`${NOMINATIM_URL}/search`, {
    headers: getHeaders(req),
    timeout: 8000,
    params: {
      q,
      format: 'jsonv2',
      addressdetails: 1,
      limit,
      countrycodes: filters.countrycodes || 'pe'
    }
  });

  return Promise.all((res.data || []).map(formatPlace));
}

async function reverseGeocode(filters = {}, req = null) {
  const latitude = toNumber(filters.latitude ?? filters.lat);
  const longitude = toNumber(filters.longitude ?? filters.lng ?? filters.lon);

  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw createHttpError(422, 'INVALID_COORDINATES', 'Debe enviar coordenadas validas.');
  }

  const res = await axios.get(`${NOMINATIM_URL}/reverse`, {
    headers: getHeaders(req),
    timeout: 8000,
    params: {
      lat: latitude,
      lon: longitude,
      format: 'jsonv2',
      addressdetails: 1
    }
  });

  return formatPlace(res.data || {});
}

module.exports = {
  searchPlaces,
  reverseGeocode
};
