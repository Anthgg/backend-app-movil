const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { query, withTransaction } = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../shared/utils/logger');
const { resolveUserAccess } = require('../../shared/utils/authz');

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'La nueva contraseÃ±a debe tener al menos 8 caracteres.';
  }
  if (!/[a-z]/.test(password)) {
    return 'La nueva contraseÃ±a debe incluir al menos una letra minÃºscula.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'La nueva contraseÃ±a debe incluir al menos una letra mayÃºscula.';
  }
  if (!/\d/.test(password)) {
    return 'La nueva contraseÃ±a debe incluir al menos un nÃºmero.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'La nueva contraseÃ±a debe incluir al menos un carÃ¡cter especial.';
  }
  return null;
}

function buildAuthPayload(user, role, permissions) {
  return {
    id: user.id,
    userId: user.id,
    role,
    email: user.email,
    companyId: user.company_id,
    company_id: user.company_id,
    permissions,
    forcePasswordChange: user.force_password_change === true
  };
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '30m' });
}

function signRefreshToken(userId) {
  return jwt.sign({ id: userId }, env.jwtRefreshSecret, { expiresIn: '7d' });
}

function verifyJwtAsync(token, secret) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        return reject(err);
      }
      resolve(decoded);
    });
  });
}

async function persistSession(userId, refreshToken) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')
       ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked = FALSE`,
      [userId, refreshToken]
    );
    await client.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
  });
}

exports.login = async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    const loginIdentifier = email || username;

    const userRes = await query(`
      SELECT 
        u.id, u.password_hash, u.is_active, u.status, u.deleted_at, u.email, u.username, u.company_id,
        COALESCE(u.force_password_change, false) AS force_password_change,
        CONCAT_WS(' ', u.first_name, u.last_name) AS name,
        p.id AS project_id, p.name AS project_name,
        COALESCE(t2.is_enabled, false) as two_factor_enabled
      FROM users u
      LEFT JOIN workers w ON u.id = w.user_id
      LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
      LEFT JOIN projects p ON pa.project_id = p.id
      LEFT JOIN two_factor_auth t2 ON u.id = t2.user_id
      WHERE LOWER(u.email) = LOWER($1)
         OR LOWER(COALESCE(u.username, '')) = LOWER($1)
      ORDER BY pa.assigned_at DESC LIMIT 1
    `, [loginIdentifier]);
    const user = userRes.rows[0];

    if (!user || user.deleted_at) {
      return res.status(401).json({ success: false, message: 'Credenciales invÃ¡lidas', error_code: 'INVALID_CREDENTIALS' });
    }

    if (!user.is_active || user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Usuario desactivado. ComunÃ­quese con Recursos Humanos.',
        error_code: 'USER_DISABLED'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales invÃ¡lidas', error_code: 'INVALID_CREDENTIALS' });
    }

    const { roles, permissions } = await resolveUserAccess(user.id, 'TRABAJADOR', user.company_id);
    const role = roles[0] || 'TRABAJADOR';

    if (user.two_factor_enabled) {
      const tempToken = jwt.sign(
        { id: user.id, email: user.email, companyId: user.company_id, role, permissions, is2faPending: true },
        env.jwtTempSecret,
        { expiresIn: '5m' }
      );

      return res.json({
        success: false,
        requiresTwoFactor: true,
        tempToken,
        message: 'Se requiere cÃ³digo 2FA',
        error_code: 'TWO_FACTOR_REQUIRED'
      });
    }

    const payload = buildAuthPayload(user, role, permissions);
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(user.id);

    await persistSession(user.id, refreshToken);

    logger.logAuth('Login exitoso', { user_id: user.id, email: user.email });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          username: user.username || user.email,
          email: user.email,
          role,
          permissions,
          companyId: user.company_id,
          projectId: user.project_id || null,
          projectName: user.project_name || null,
          isActive: user.is_active,
          isBlocked: user.status === 'blocked',
          forcePasswordChange: user.force_password_change === true,
          mustChangePassword: user.force_password_change === true,
          requiresTwoFactor: false
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token requerido', error_code: 'REFRESH_TOKEN_REQUIRED' });
    }

    let decoded;
    try {
      decoded = await verifyJwtAsync(refreshToken, env.jwtRefreshSecret);
    } catch (err) {
      const isExpired = err.name === 'TokenExpiredError';
      return res.status(403).json({
        success: false,
        message: isExpired ? 'SesiÃ³n de refresco expirada' : 'Token de refresco invÃ¡lido',
        error_code: isExpired ? 'SESSION_EXPIRED' : 'INVALID_REFRESH_TOKEN'
      });
    }

    const userRes = await query(
      'SELECT id, is_active, status, email, company_id FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = userRes.rows[0];

    if (!user || !user.is_active || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Usuario no autorizado o bloqueado', error_code: 'USER_DISABLED' });
    }

    const { roles, permissions } = await resolveUserAccess(user.id, 'TRABAJADOR', user.company_id);
    const role = roles[0] || 'TRABAJADOR';
    const payload = buildAuthPayload(user, role, permissions);
    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(user.id);

    const rotated = await withTransaction(async (client) => {
      const rtRes = await client.query(
        `SELECT id
         FROM refresh_tokens
         WHERE token = $1 AND revoked = FALSE
         FOR UPDATE`,
        [refreshToken]
      );

      if (rtRes.rows.length === 0) {
        return null;
      }

      const oldTokenId = rtRes.rows[0].id;
      const revokeRes = await client.query(
        `UPDATE refresh_tokens
         SET revoked = TRUE
         WHERE id = $1 AND revoked = FALSE
         RETURNING id`,
        [oldTokenId]
      );

      if (revokeRes.rows.length === 0) {
        return null;
      }

      await client.query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [user.id, newRefreshToken]
      );

      return { oldTokenId };
    });

    if (!rotated) {
      logger.logWarn('AUTH', 'Refresh token ya revocado o consumido concurrentemente', {
        user_id: user.id
      });
      return res.status(403).json({
        success: false,
        message: 'Token invÃ¡lido o revocado',
        error_code: 'INVALID_REFRESH_TOKEN'
      });
    }

    logger.logAuth('Refresh token rotado correctamente', {
      user_id: user.id,
      old_token_id: rotated.oldTokenId
    });

    res.json({ success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch (error) {
    next(error);
  }
};

exports.get2FAStatus = async (req, res, next) => {
  try {
    const res2fa = await query('SELECT is_enabled FROM two_factor_auth WHERE user_id = $1', [req.user.id]);
    res.json({ success: true, data: { enabled: res2fa.rows[0]?.is_enabled || false } });
  } catch (error) {
    next(error);
  }
};

exports.enable2FA = async (req, res, next) => {
  try {
    const secret = speakeasy.generateSecret({ name: `FABRYOR:${req.user.email}` });

    await query(`
      INSERT INTO two_factor_auth (user_id, secret_key, is_enabled) 
      VALUES ($1, $2, false)
      ON CONFLICT (user_id) DO UPDATE SET secret_key = $2, is_enabled = false
    `, [req.user.id, secret.base32]);

    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) return next(err);
      res.json({
        success: true,
        data: {
          qr_code: data_url,
          secret: secret.base32,
          otpauth_url: secret.otpauth_url
        }
      });
    });
  } catch (error) {
    next(error);
  }
};

exports.confirm2FA = async (req, res, next) => {
  try {
    const { code } = req.body;
    const user2fa = await query('SELECT secret_key FROM two_factor_auth WHERE user_id = $1', [req.user.id]);

    if (user2fa.rows.length === 0) return res.status(400).json({ success: false, message: '2FA no configurado', error_code: '2FA_NOT_CONFIGURED' });

    const verified = speakeasy.totp.verify({
      secret: user2fa.rows[0].secret_key,
      encoding: 'base32',
      token: code
    });

    if (verified) {
      await query('UPDATE two_factor_auth SET is_enabled = true WHERE user_id = $1', [req.user.id]);
      logger.logChange('AUTH', '2FA Activado', { user_id: req.user.id });
      res.json({ success: true, message: '2FA activado correctamente' });
    } else {
      res.status(400).json({ success: false, message: 'CÃ³digo invÃ¡lido', error_code: 'INVALID_2FA_CODE' });
    }
  } catch (error) {
    next(error);
  }
};

exports.disable2FA = async (req, res, next) => {
  try {
    await query('DELETE FROM two_factor_auth WHERE user_id = $1', [req.user.id]);
    logger.logChange('AUTH', '2FA Desactivado', { user_id: req.user.id });
    res.json({ success: true, message: '2FA desactivado correctamente' });
  } catch (error) {
    next(error);
  }
};

exports.verify2FALogin = async (req, res, next) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ success: false, message: 'Token temporal y cÃ³digo requeridos', error_code: 'MISSING_FIELDS' });
    }

    const decoded = await verifyJwtAsync(tempToken, env.jwtTempSecret).catch(() => null);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Token temporal invÃ¡lido o expirado', error_code: 'INVALID_TEMP_TOKEN' });
    }

    const user2fa = await query('SELECT secret_key, is_enabled FROM two_factor_auth WHERE user_id = $1', [decoded.id]);
    if (user2fa.rows.length === 0 || !user2fa.rows[0].is_enabled) {
      return res.status(400).json({ success: false, message: '2FA no estÃ¡ activo para este usuario', error_code: '2FA_NOT_ENABLED' });
    }

    const verified = speakeasy.totp.verify({
      secret: user2fa.rows[0].secret_key,
      encoding: 'base32',
      token: code
    });

    if (!verified) {
      return res.status(400).json({ success: false, message: 'CÃ³digo 2FA incorrecto', error_code: 'INVALID_2FA_CODE' });
    }

    const userRes = await query(`
      SELECT 
        u.id, u.email, u.username, u.company_id, u.is_active, u.status,
        COALESCE(u.force_password_change, false) AS force_password_change,
        CONCAT_WS(' ', u.first_name, u.last_name) AS name,
        p.id AS project_id, p.name AS project_name
      FROM users u
      LEFT JOIN workers w ON u.id = w.user_id
      LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
      LEFT JOIN projects p ON pa.project_id = p.id
      WHERE u.id = $1
      ORDER BY pa.assigned_at DESC LIMIT 1
    `, [decoded.id]);
    const user = userRes.rows[0];

    const payload = buildAuthPayload(user, decoded.role, decoded.permissions);
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(user.id);

    await persistSession(user.id, refreshToken);

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          username: user.username || user.email,
          email: user.email,
          role: decoded.role,
          permissions: decoded.permissions,
          companyId: user.company_id,
          projectId: user.project_id || null,
          projectName: user.project_name || null,
          isActive: user.is_active,
          isBlocked: user.status === 'blocked',
          forcePasswordChange: user.force_password_change === true,
          mustChangePassword: user.force_password_change === true,
          requiresTwoFactor: true
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1', [refreshToken]);
    }
    logger.logChange('AUTH', 'Usuario cerrÃ³ sesiÃ³n', { user_id: req.user.id });
    res.json({ success: true, message: 'Logout exitoso' });
  } catch (error) {
    next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'currentPassword y newPassword son obligatorios.',
        code: 'MISSING_FIELDS',
        error_code: 'MISSING_FIELDS'
      });
    }

    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
      return res.status(422).json({
        success: false,
        message: strengthError,
        code: 'WEAK_PASSWORD',
        error_code: 'WEAK_PASSWORD'
      });
    }

    if (currentPassword === newPassword) {
      return res.status(422).json({
        success: false,
        message: 'La nueva contraseÃ±a debe ser diferente a la actual.',
        code: 'PASSWORD_REUSED',
        error_code: 'PASSWORD_REUSED'
      });
    }

    const userRes = await query(
      'SELECT id, password_hash, deleted_at, is_active, status FROM users WHERE id = $1',
      [userId]
    );
    const user = userRes.rows[0];

    if (!user || user.deleted_at) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no vÃ¡lido.',
        code: 'INVALID_USER',
        error_code: 'INVALID_USER'
      });
    }

    if (!user.is_active || user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Usuario desactivado. ComunÃ­quese con Recursos Humanos.',
        code: 'USER_DISABLED',
        error_code: 'USER_DISABLED'
      });
    }

    const currentMatches = await bcrypt.compare(currentPassword, user.password_hash);
    if (!currentMatches) {
      return res.status(401).json({
        success: false,
        message: 'La contraseÃ±a actual es incorrecta.',
        code: 'INVALID_CURRENT_PASSWORD',
        error_code: 'INVALID_CURRENT_PASSWORD'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE users
       SET password_hash = $1,
           force_password_change = false,
           last_password_change_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId]
    );

    logger.logChange('AUTH', 'ContraseÃ±a actualizada', { user_id: userId });

    return res.json({
      success: true,
      message: 'ContraseÃ±a actualizada correctamente.'
    });
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const userRes = await query(`
      SELECT u.id,
             CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
             u.first_name, u.last_name,
             u.email, u.is_active, u.company_id, r.name as role,
             u.profile_photo_url,
             p.id as project_id, p.name as project_name,
             (SELECT array_agg(p.name) FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ur.role_id) as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN workers w ON u.id = w.user_id
      LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
      LEFT JOIN projects p ON pa.project_id = p.id
      WHERE u.id = $1 AND u.deleted_at IS NULL
      ORDER BY pa.assigned_at DESC LIMIT 1
    `, [req.user.id]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const rawUser = userRes.rows[0];
    const userPayload = {
      ...rawUser,
      profile_photo_url: rawUser.profile_photo_url || null,
      profilePhotoUrl: rawUser.profile_photo_url || null,
      avatarUrl: rawUser.profile_photo_url || null,
      avatar_url: rawUser.profile_photo_url || null
    };

    res.json({ success: true, data: userPayload });
  } catch (error) {
    next(error);
  }
};

exports.verifyPassword = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, message: 'La contraseña es obligatoria' });
    }

    const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const matches = await bcrypt.compare(password, userRes.rows[0].password_hash);
    if (!matches) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    res.json({ success: true, message: 'Contraseña verificada' });
  } catch (error) {
    next(error);
  }
};
