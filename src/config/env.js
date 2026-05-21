const fs = require('fs');
const path = require('path');

if (process.env.NODE_ENV !== 'production') {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
}

const companyAssetsBucket = process.env.SUPABASE_COMPANY_ASSETS_BUCKET || 'company-assets';
const requestDocumentsBucket = process.env.SUPABASE_REQUEST_DOCUMENTS_BUCKET || 'request-documents';
const attendancePhotosBucket = process.env.SUPABASE_ATTENDANCE_PHOTOS_BUCKET || 'attendance-photos';
const workerDocumentsBucket = process.env.SUPABASE_WORKER_DOCUMENTS_BUCKET || requestDocumentsBucket;

module.exports = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  companyAssetsBucket,
  requestDocumentsBucket,
  workerDocumentsBucket,
  attendancePhotosBucket,
  requiredStorageBuckets: [
    companyAssetsBucket,
    requestDocumentsBucket,
    attendancePhotosBucket
  ],
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtTempSecret: process.env.JWT_TEMP_SECRET || 'fallback_temp_secret',
  
  validateEnv() {
    const requiredVars = [
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET'
    ];

    const missing = requiredVars.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
    }
  }
};
