const { query } = require('../../config/database');
const { getWorkerShift } = require('../attendance-service/services/mobile-attendance.service');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERU_PHONE_REGEX = /^9\d{8}$/;

function normalizeRole(roles = []) {
  const primary = roles[0] || 'WORKER';
  const upper = primary.toUpperCase();
  const map = {
    TRABAJADOR: 'worker',
    WORKER: 'worker',
    ADMIN: 'admin',
    RRHH: 'rrhh',
    SUPERVISOR: 'supervisor'
  };
  return map[upper] || primary.toLowerCase();
}

function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function serializeProfile(row, roles = []) {
  return {
    id: row.user_id || row.id,
    fullName: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' '),
    role: normalizeRole(roles),
    position: row.position_name || null,
    company: row.company_name || null,
    profilePhotoUrl: row.profile_photo_url || row.user_profile_photo_url || null,
    phone: row.phone_number || null,
    personalEmail: row.personal_email || null,
    birthDate: formatDateOnly(row.birth_date),
    address: row.address || null,
    emergencyContactName: row.emergency_contact_name || null,
    emergencyContactPhone: row.emergency_contact_phone || null,
    shift: row.shift_id ? {
      id: row.shift_id,
      name: row.shift_name,
      startTime: row.shift_start,
      endTime: row.shift_end,
      toleranceMinutes: Number(row.shift_tolerance || 0)
    } : null
  };
}

async function getProfileRow(userId, tenantId) {
  const result = await query(`
    SELECT
      u.id AS user_id,
      u.first_name,
      u.last_name,
      CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
      w.id AS worker_id,
      w.phone_number,
      w.personal_email,
      w.birth_date,
      w.address,
      w.emergency_contact_name,
      w.emergency_contact_phone,
      w.profile_photo_url,
      u.profile_photo_url AS user_profile_photo_url,
      w.company_id,
      jp.name AS position_name,
      c.name AS company_name,
      NULL::uuid AS shift_id,
      NULL::text AS shift_name,
      NULL::text AS shift_start,
      NULL::text AS shift_end,
      NULL::integer AS shift_tolerance
    FROM users u
    LEFT JOIN workers w
      ON w.user_id = u.id
     AND w.company_id = u.company_id
     AND w.deleted_at IS NULL
    LEFT JOIN job_positions jp ON jp.id = w.job_position_id
    LEFT JOIN companies c ON c.id = w.company_id
    WHERE u.id = $1
      AND u.company_id = $2
      AND u.deleted_at IS NULL
    LIMIT 1
  `, [userId, tenantId]);

  return result.rows[0] || null;
}

class ProfileService {
  async getProfile(userId, tenantId, roles = []) {
    const row = await getProfileRow(userId, tenantId);

    if (!row) {
      const err = new Error('Usuario no encontrado.');
      err.statusCode = 404;
      throw err;
    }

    const shift = row.worker_id ? await getWorkerShift(row.worker_id, tenantId) : null;
    return {
      ...serializeProfile(row, roles),
      shift
    };
  }

  async getMyShift(userId, tenantId) {
    const row = await getProfileRow(userId, tenantId);

    if (!row) {
      const err = new Error('Usuario no encontrado.');
      err.statusCode = 404;
      throw err;
    }

    return row.worker_id ? await getWorkerShift(row.worker_id, tenantId) : null;
  }

  async updateProfile(userId, tenantId, data, roles = []) {
    const {
      phone,
      personalEmail,
      birthDate,
      address,
      emergencyContactName,
      emergencyContactPhone
    } = data;

    if (phone !== undefined && phone !== null && phone !== '' && !PERU_PHONE_REGEX.test(phone)) {
      const err = new Error('El celular debe ser peruano y tener 9 dígitos.');
      err.statusCode = 400;
      err.errorCode = 'INVALID_PHONE';
      throw err;
    }

    if (emergencyContactPhone !== undefined && emergencyContactPhone !== null && emergencyContactPhone !== '' && !PERU_PHONE_REGEX.test(emergencyContactPhone)) {
      const err = new Error('El celular de emergencia debe ser peruano y tener 9 dígitos.');
      err.statusCode = 400;
      err.errorCode = 'INVALID_EMERGENCY_PHONE';
      throw err;
    }

    if (personalEmail !== undefined && personalEmail !== null && personalEmail !== '' && !EMAIL_REGEX.test(personalEmail)) {
      const err = new Error('Correo invalido.');
      err.statusCode = 400;
      err.errorCode = 'INVALID_EMAIL';
      throw err;
    }

    if (birthDate) {
      const parsed = new Date(birthDate);
      if (Number.isNaN(parsed.getTime()) || parsed > new Date()) {
        const err = new Error('La fecha de nacimiento no puede ser futura.');
        err.statusCode = 400;
        err.errorCode = 'INVALID_BIRTH_DATE';
        throw err;
      }
    }

    const updated = await query(`
      UPDATE workers
      SET
        phone_number = $1,
        personal_email = $2,
        birth_date = $3,
        address = $4,
        emergency_contact_name = $5,
        emergency_contact_phone = $6,
        updated_at = NOW()
      WHERE user_id = $7
        AND company_id = $8
        AND deleted_at IS NULL
      RETURNING user_id
    `, [
      phone ?? null,
      personalEmail ?? null,
      birthDate ?? null,
      address ?? null,
      emergencyContactName ?? null,
      emergencyContactPhone ?? null,
      userId,
      tenantId
    ]);

    if (updated.rows.length === 0) {
      const err = new Error('No tienes un perfil de trabajador activo asociado.');
      err.statusCode = 403;
      err.errorCode = 'WORKER_PROFILE_REQUIRED';
      throw err;
    }

    return this.getProfile(userId, tenantId, roles);
  }

  async updatePhoto(userId, tenantId, photoUrl, roles = []) {
    const workerResult = await query(`
      UPDATE workers
      SET profile_photo_url = $1,
          updated_at = NOW()
      WHERE user_id = $2
        AND company_id = $3
        AND deleted_at IS NULL
      RETURNING user_id
    `, [photoUrl, userId, tenantId]);

    if (workerResult.rows.length === 0) {
      const userResult = await query(`
        UPDATE users
        SET profile_photo_url = $1,
            updated_at = NOW()
        WHERE id = $2
          AND company_id = $3
          AND deleted_at IS NULL
        RETURNING id
      `, [photoUrl, userId, tenantId]);

      if (userResult.rows.length === 0) {
        const err = new Error('No tienes un perfil de usuario activo asociado.');
        err.statusCode = 403;
        err.errorCode = 'USER_PROFILE_REQUIRED';
        throw err;
      }
    }

    return this.getProfile(userId, tenantId, roles);
  }

  async deletePhoto(userId, tenantId) {
    const workerResult = await query(`
      UPDATE workers
      SET profile_photo_url = NULL,
          updated_at = NOW()
      WHERE user_id = $1
        AND company_id = $2
        AND deleted_at IS NULL
      RETURNING user_id
    `, [userId, tenantId]);

    if (workerResult.rows.length === 0) {
      const userResult = await query(`
        UPDATE users
        SET profile_photo_url = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND company_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `, [userId, tenantId]);

      if (userResult.rows.length === 0) {
        const err = new Error('No tienes un perfil de usuario activo asociado.');
        err.statusCode = 403;
        err.errorCode = 'USER_PROFILE_REQUIRED';
        throw err;
      }
    }

    return { success: true };
  }
}

module.exports = new ProfileService();
