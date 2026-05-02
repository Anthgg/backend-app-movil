const crypto = require('crypto');

console.log("==========================================");
console.log("    GENERADOR DE SECRETOS DE PRODUCCIÓN");
console.log("==========================================\n");

const jwtSecret = crypto.randomBytes(64).toString('hex');
const jwtRefreshSecret = crypto.randomBytes(64).toString('hex');
const cronSecret = crypto.randomBytes(64).toString('hex');
const swaggerPassword = crypto.randomBytes(32).toString('base64url');

console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`JWT_REFRESH_SECRET=${jwtRefreshSecret}`);
console.log(`CRON_SECRET=${cronSecret}`);
console.log(`SWAGGER_PASSWORD=${swaggerPassword}`);

console.log("\n==========================================");
console.log("        ADVERTENCIA DE SEGURIDAD ");
console.log("Guarda estos valores en .env.production.local o cópialos en Google Secret Manager.");
console.log("NUNCA los subas a Git ni los compartas en texto plano.");
console.log("==========================================\n");
