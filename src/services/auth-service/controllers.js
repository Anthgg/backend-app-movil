const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { query } = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../shared/utils/logger');

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Buscar usuario con su proyecto asignado, estado de 2FA y metadata multiempresa
    const userRes = await query(`
      SELECT 
        u.id, u.password_hash, u.is_active, u.status, u.deleted_at, u.email, u.company_id,
        CONCAT_WS(' ', u.first_name, u.last_name) AS name,
        p.id AS project_id, p.name AS project_name,
        COALESCE(t2.is_enabled, false) as 2fa_enabled
      FROM users u
      LEFT JOIN workers w ON u.id = w.user_id
      LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
      LEFT JOIN projects p ON pa.project_id = p.id
      LEFT JOIN two_factor_auth t2 ON u.id = t2.user_id
      WHERE u.email = $1
      ORDER BY pa.assigned_at DESC LIMIT 1
    `, [email]);
    const user = userRes.rows[0];

    if (!user || user.deleted_at) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas', error_code: 'INVALID_CREDENTIALS' });
    }

    // Validar is_active y status
    if (!user.is_active || user.status !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: 'Usuario desactivado. Comuníquese con Recursos Humanos.', 
        error_code: 'USER_DISABLED' 
      });
    }

    // Verificar password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas', error_code: 'INVALID_CREDENTIALS' });
    }

    // Obtener Rol y Permisos
    const roleRes = await query(`
      SELECT r.name as role_name, r.id as role_id FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = $1 LIMIT 1
    `, [user.id]);
    
    const role = roleRes.rows[0]?.role_name || 'TRABAJADOR';
    const roleId = roleRes.rows[0]?.role_id;

    let permissions = [];
    if (roleId) {
      const permRes = await query(`
        SELECT p.name FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = $1
      `, [roleId]);
      permissions = permRes.rows.map(p => p.name);
    }

    // --- FLUJO 2FA ---
    if (user['2fa_enabled']) {
      // Generar tempToken (5 min)
      const tempToken = jwt.sign(
        { id: user.id, email: user.email, companyId: user.company_id, role, permissions, is2faPending: true },
        env.jwtTempSecret,
        { expiresIn: '5m' }
      );

      return res.json({
        success: false,
        requiresTwoFactor: true,
        tempToken,
        message: 'Se requiere código 2FA',
        error_code: 'TWO_FACTOR_REQUIRED'
      });
    }

    // --- FLUJO NORMAL (Sin 2FA) ---
    const payload = { 
      id: user.id, 
      userId: user.id,
      role, 
      email: user.email,
      companyId: user.company_id,
      company_id: user.company_id,
      permissions
    };

    const accessToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '30m' });
    const refreshToken = jwt.sign({ id: user.id }, env.jwtRefreshSecret, { expiresIn: '7d' });

    // Guardar refresh token y actualizar last_login
    await query('BEGIN');
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')
       ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked = FALSE`,
      [user.id, refreshToken]
    );
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    await query('COMMIT');

    logger.logAuth('Login exitoso', { user_id: user.id, email: user.email });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { 
          id: user.id, 
          name: user.name,
          username: user.email,
          email: user.email, 
          role,
          permissions,
          companyId: user.company_id,
          projectId: user.project_id || null,
          projectName: user.project_name || null,
          isActive: user.is_active,
          isBlocked: user.status === 'blocked',
          requiresTwoFactor: false
        }
      }
    });
  } catch (error) {
    if (query.activeTransaction) await query('ROLLBACK');
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'Refresh token requerido', error_code: 'REFRESH_TOKEN_REQUIRED' });

    // Verificar en BD
    const rtRes = await query('SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE', [refreshToken]);
    if (rtRes.rows.length === 0) return res.status(403).json({ success: false, message: 'Token inválido o revocado', error_code: 'INVALID_REFRESH_TOKEN' });

    const rtData = rtRes.rows[0];

    jwt.verify(refreshToken, env.jwtRefreshSecret, async (err, decoded) => {
      if (err) {
        const isExpired = err.name === 'TokenExpiredError';
        return res.status(403).json({ 
          success: false, 
          message: isExpired ? 'Sesión de refresco expirada' : 'Token de refresco inválido',
          error_code: isExpired ? 'SESSION_EXPIRED' : 'INVALID_REFRESH_TOKEN'
        });
      }
      
      // Validar que el usuario siga activo
      const userRes = await query('SELECT id, is_active, status, email, company_id FROM users WHERE id = $1', [decoded.id]);
      const user = userRes.rows[0];
      
      if (!user || !user.is_active || user.status !== 'active') {
        return res.status(403).json({ success: false, message: 'Usuario no autorizado o bloqueado', error_code: 'USER_DISABLED' });
      }

      // Obtener rol y permisos para el nuevo token
      const roleRes = await query(`
        SELECT r.name as role_name, r.id as role_id FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = $1 LIMIT 1
      `, [user.id]);
      const role = roleRes.rows[0]?.role_name || 'TRABAJADOR';
      const roleId = roleRes.rows[0]?.role_id;

      let permissions = [];
      if (roleId) {
        const permRes = await query(`
          SELECT p.name FROM permissions p
          JOIN role_permissions rp ON p.id = rp.permission_id
          WHERE rp.role_id = $1
        `, [roleId]);
        permissions = permRes.rows.map(p => p.name);
      }

      const payload = { 
        id: user.id, 
        userId: user.id,
        role, 
        email: user.email,
        companyId: user.company_id,
        company_id: user.company_id,
        permissions
      };

      const newAccessToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '30m' });
      
      // Opcional: Rotación de Refresh Token
      const newRefreshToken = jwt.sign({ id: user.id }, env.jwtRefreshSecret, { expiresIn: '7d' });
      
      await query('BEGIN');
      await query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [rtData.id]);
      await query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [user.id, newRefreshToken]
      );
      await query('COMMIT');

      res.json({ success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
    });
  } catch (error) {
    if (query.activeTransaction) await query('ROLLBACK');
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
      res.status(400).json({ success: false, message: 'Código inválido', error_code: 'INVALID_2FA_CODE' });
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
      return res.status(400).json({ success: false, message: 'Token temporal y código requeridos', error_code: 'MISSING_FIELDS' });
    }

    jwt.verify(tempToken, env.jwtTempSecret, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ success: false, message: 'Token temporal inválido o expirado', error_code: 'INVALID_TEMP_TOKEN' });
      }

      const user2fa = await query('SELECT secret_key, is_enabled FROM two_factor_auth WHERE user_id = $1', [decoded.id]);
      if (user2fa.rows.length === 0 || !user2fa.rows[0].is_enabled) {
        return res.status(400).json({ success: false, message: '2FA no está activo para este usuario', error_code: '2FA_NOT_ENABLED' });
      }

      const verified = speakeasy.totp.verify({
        secret: user2fa.rows[0].secret_key,
        encoding: 'base32',
        token: code
      });

      if (!verified) {
        return res.status(400).json({ success: false, message: 'Código 2FA incorrecto', error_code: 'INVALID_2FA_CODE' });
      }

      // Login exitoso tras 2FA -> Generar tokens finales
      // Re-fetch user data to ensure latest info (projects, etc.)
      const userRes = await query(`
        SELECT 
          u.id, u.email, u.company_id, u.is_active, u.status,
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

      const payload = { 
        id: user.id, 
        userId: user.id,
        role: decoded.role, 
        email: user.email,
        companyId: user.company_id,
        company_id: user.company_id,
        permissions: decoded.permissions
      };

      const accessToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '30m' });
      const refreshToken = jwt.sign({ id: user.id }, env.jwtRefreshSecret, { expiresIn: '7d' });

      await query('BEGIN');
      await query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')
         ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked = FALSE`,
        [user.id, refreshToken]
      );
      await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
      await query('COMMIT');

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: { 
            id: user.id, 
            name: user.name,
            username: user.email,
            email: user.email, 
            role: decoded.role,
            permissions: decoded.permissions,
            companyId: user.company_id,
            projectId: user.project_id || null,
            projectName: user.project_name || null,
            isActive: user.is_active,
            isBlocked: user.status === 'blocked',
            requiresTwoFactor: true
          }
        }
      });
    });
  } catch (error) {
    if (query.activeTransaction) await query('ROLLBACK');
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1', [refreshToken]);
    }
    logger.logChange('AUTH', 'Usuario cerró sesión', { user_id: req.user.id });
    res.json({ success: true, message: 'Logout exitoso' });
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

    res.json({ success: true, data: userRes.rows[0] });
  } catch (error) {
    next(error);
  }
};
