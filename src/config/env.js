require('dotenv').config();

module.exports = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  
  validateEnv() {
    const requiredVars = [
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET'
    ];

    const missing = requiredVars.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
    }
  }
};
