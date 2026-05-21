const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (!/[a-z]/.test(password)) {
    return 'La contraseña debe incluir al menos una letra minúscula.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'La contraseña debe incluir al menos una letra mayúscula.';
  }
  if (!/\d/.test(password)) {
    return 'La contraseña debe incluir al menos un número.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'La contraseña debe incluir al menos un símbolo.';
  }
  return null;
}

function generateTemporaryPassword(companyName = 'Fabryor') {
  const prefix = String(companyName || 'Fabryor')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 8) || 'Fabryor';
  const normalizedPrefix = `${prefix.charAt(0).toUpperCase()}${prefix.slice(1).toLowerCase()}`;
  const random = crypto.randomBytes(4).toString('base64url');
  const number = String(new Date().getUTCFullYear());
  return `${normalizedPrefix}@${number}${random}`;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

module.exports = {
  validatePasswordStrength,
  generateTemporaryPassword,
  hashPassword
};
