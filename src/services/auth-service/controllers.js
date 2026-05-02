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

    // Buscar usuario (ignorando eliminados)
    const userRes = await query('SELECT id, password_hash, is_active, status, deleted_at FROM users WHERE email = $1', [email]);
    const user = userRes.rows[0];

    if (!user || user.deleted_at) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    // Validar is_active y status
    if (!user.is_active || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Usuario desactivado. Comuníquese con Recursos Humanos.', error_code: 'USER_DISABLED' });
    }

    // Verificar password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    // Buscar rol principal (simplificado para el ejemplo)
    const roleRes = await query(`
      SELECT r.name FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = $1 LIMIT 1
    `, [user.id]);
    const role = roleRes.rows[0]?.name || 'TRABAJADOR';

    // Generar Tokens
    const accessToken = jwt.sign({ id: user.id, role, email }, env.jwtSecret, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ id: user.id }, env.jwtRefreshSecret, { expiresIn: '7d' });

    // Guardar refresh token y actualizar last_login
    await query('BEGIN');
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')', [user.id, refreshToken]);
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    await query('COMMIT');

    logger.logAuth('Login exitoso', { user_id: user.id, email });
    logger.logChange('AUTH', 'Usuario inició sesión', { user_id: user.id });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { id: user.id, email, role }
      }
    });
  } catch (error) {
    await query('ROLLBACK');
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(401).json({ success: false, message: 'Refresh token requerido' });

    // Verificar en BD
    const rtRes = await query('SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE', [token]);
    if (rtRes.rows.length === 0) return res.status(403).json({ success: false, message: 'Token inválido o revocado' });

    jwt.verify(token, env.jwtRefreshSecret, (err, user) => {
      if (err) return res.status(403).json({ success: false, message: 'Token expirado' });
      
      const newAccessToken = jwt.sign({ id: user.id }, env.jwtSecret, { expiresIn: '15m' });
      res.json({ success: true, data: { accessToken: newAccessToken } });
    });
  } catch (error) {
    next(error);
  }
};

exports.generate2FA = async (req, res, next) => {
  try {
    const secret = speakeasy.generateSecret({ name: 'HRApp' });
    
    // Guardar en BD (normalmente se guarda temporalmente hasta que se verifique)
    await query(`
      INSERT INTO two_factor_auth (user_id, secret_key) 
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET secret_key = $2, is_enabled = false
    `, [req.user.id, secret.base32]);

    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      res.json({ success: true, data: { qr_code: data_url, secret: secret.base32 } });
    });
  } catch (error) {
    next(error);
  }
};

exports.verify2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    const user2fa = await query('SELECT secret_key FROM two_factor_auth WHERE user_id = $1', [req.user.id]);
    
    if (user2fa.rows.length === 0) return res.status(400).json({ success: false, message: '2FA no configurado' });

    const verified = speakeasy.totp.verify({
      secret: user2fa.rows[0].secret_key,
      encoding: 'base32',
      token
    });

    if (verified) {
      await query('UPDATE two_factor_auth SET is_enabled = true WHERE user_id = $1', [req.user.id]);
      logger.logChange('AUTH', '2FA Activado', { user_id: req.user.id });
      res.json({ success: true, message: '2FA activado correctamente' });
    } else {
      res.status(400).json({ success: false, message: 'Código inválido' });
    }
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
    logger.logChange('AUTH', 'Usuario cerró sesión', { user_id: req.user.id });
    res.json({ success: true, message: 'Logout exitoso' });
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const userRes = await query(`
      SELECT u.id, u.full_name, u.email, u.is_active, u.company_id, r.name as role,
      (SELECT array_agg(p.name) FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ur.role_id) as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1 AND u.deleted_at IS NULL
    `, [req.user.id]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    res.json({ success: true, data: userRes.rows[0] });
  } catch (error) {
    next(error);
  }
};
