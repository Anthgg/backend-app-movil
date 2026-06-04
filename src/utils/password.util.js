const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*-_=+?';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

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
  if (!/[!@#$%&*\-_=+?]/.test(password)) {
    return 'La contraseña debe incluir al menos un símbolo permitido (!@#$%&*-_=+?).';
  }
  return null;
}

/**
 * Verifica que una contraseña temporal cumpla la política mínima de seguridad.
 * @param {string} password
 * @returns {boolean}
 */
function isStrongTemporaryPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[!@#$%&*\-_=+?]/.test(password)
  );
}

/**
 * Genera una contraseña temporal criptográficamente segura de 10 caracteres.
 * Garantiza al menos: 1 mayúscula, 1 minúscula, 1 dígito, 1 símbolo.
 * NO persiste ni registra la contraseña — solo la retorna en memoria.
 * @returns {string}
 */
function generateTemporaryPassword() {
  const pick = (charset) => charset[crypto.randomInt(0, charset.length)];

  // Garantizar un carácter de cada clase obligatoria
  const mandatory = [
    pick(UPPER),
    pick(LOWER),
    pick(DIGITS),
    pick(SYMBOLS),
  ];

  // Completar hasta 10 caracteres con el conjunto completo
  const extra = Array.from({ length: 6 }, () => pick(ALL));

  const chars = [...mandatory, ...extra];

  // Fisher-Yates shuffle con crypto.randomInt para evitar sesgo
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  const password = chars.join('');

  // Defensa en profundidad: si por alguna razón no cumple, regenerar una vez
  if (!isStrongTemporaryPassword(password)) {
    return generateTemporaryPassword();
  }

  return password;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

module.exports = {
  validatePasswordStrength,
  isStrongTemporaryPassword,
  generateTemporaryPassword,
  hashPassword,
};
