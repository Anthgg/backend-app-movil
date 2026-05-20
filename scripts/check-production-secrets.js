require('dotenv').config({ path: '.env.production.local' });
// Si no existe .env.production.local, intentara leer el entorno actual

console.log('Iniciando validacion estricta de secretos de produccion...\n');

const requiredSecrets = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'CRON_SECRET',
  'SWAGGER_PASSWORD',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

let hasErrors = false;

requiredSecrets.forEach((secret) => {
  if (!process.env[secret]) {
    console.error(`Falta la variable requerida: ${secret}`);
    hasErrors = true;
  }
});

if (hasErrors) {
  console.error('\nAbortando por variables faltantes. Asegurate de cargar .env.production.local o definir el entorno.');
  process.exit(1);
}

const jwtSecret = process.env.JWT_SECRET;
const jwtRefresh = process.env.JWT_REFRESH_SECRET;
const cronSecret = process.env.CRON_SECRET;
const swaggerPass = process.env.SWAGGER_PASSWORD;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const maskString = (str) => {
  if (!str || str.length < 12) return '********';
  return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
};

const weakValues = [
  'secret_real_seguro',
  'refresh_secret_real_seguro',
  'cron_secret_seguro',
  'password_seguro',
  'admin',
  '123456',
  'password'
];

if (weakValues.includes(jwtSecret)) { console.error('JWT_SECRET es muy debil o es un placeholder.'); hasErrors = true; }
if (weakValues.includes(jwtRefresh)) { console.error('JWT_REFRESH_SECRET es muy debil o es un placeholder.'); hasErrors = true; }
if (weakValues.includes(cronSecret)) { console.error('CRON_SECRET es muy debil o es un placeholder.'); hasErrors = true; }
if (weakValues.includes(swaggerPass)) { console.error('SWAGGER_PASSWORD es muy debil o es un placeholder.'); hasErrors = true; }
if (!supabaseServiceRoleKey.startsWith('sb_secret_')) { console.error('SUPABASE_SERVICE_ROLE_KEY no parece una service role key valida.'); hasErrors = true; }

if (jwtSecret.length < 64) { console.error(`JWT_SECRET es muy corto (${jwtSecret.length} chars). Minimo 64.`); hasErrors = true; }
if (jwtRefresh.length < 64) { console.error(`JWT_REFRESH_SECRET es muy corto (${jwtRefresh.length} chars). Minimo 64.`); hasErrors = true; }
if (cronSecret.length < 64) { console.error(`CRON_SECRET es muy corto (${cronSecret.length} chars). Minimo 64.`); hasErrors = true; }
if (swaggerPass.length < 24) { console.error(`SWAGGER_PASSWORD es muy corto (${swaggerPass.length} chars). Minimo 24.`); hasErrors = true; }

if (jwtSecret === jwtRefresh) { console.error('JWT_SECRET y JWT_REFRESH_SECRET no pueden ser el mismo valor.'); hasErrors = true; }
if (jwtSecret === cronSecret) { console.error('JWT_SECRET y CRON_SECRET no pueden ser el mismo valor.'); hasErrors = true; }
if (swaggerPass === cronSecret) { console.error('SWAGGER_PASSWORD y CRON_SECRET no pueden ser el mismo valor.'); hasErrors = true; }

if (hasErrors) {
  console.error("\nVerificacion fallida. Por favor, regenera tus secretos usando 'npm run generate:secrets'.");
  process.exit(1);
}

console.log('Todas las variables requeridas estan presentes.');
console.log('No se detectaron valores de placeholder debiles.');
console.log('La longitud criptografica es correcta (minimo 64 chars para JWT/CRON, 24 para Swagger).');
console.log('Las claves maestras no estan duplicadas.');

console.log('\n--- Huellas de Secretos (para verificacion de inyeccion) ---');
console.log(`JWT_SECRET: ${maskString(jwtSecret)}`);
console.log(`JWT_REFRESH_SECRET: ${maskString(jwtRefresh)}`);
console.log(`CRON_SECRET: ${maskString(cronSecret)}`);
console.log(`SWAGGER_PASSWORD: ${maskString(swaggerPass)}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${maskString(supabaseServiceRoleKey)}`);

console.log('\nValidacion de secretos completada con exito. Listo para produccion.');
process.exit(0);
