const { createClient } = require('@supabase/supabase-js');
const env = require('./env');
const logger = require('../shared/utils/logger');

let supabaseServiceClient;
let supabasePublicClient;

const cleanValue = (value) => value.replace(/^['"]|['"]$/g, '').trim();

const buildClient = (key) => createClient(cleanValue(env.supabaseUrl), cleanValue(key), {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const getSupabaseClient = () => {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return null;
  }

  if (!supabaseServiceClient) {
    supabaseServiceClient = buildClient(env.supabaseServiceRoleKey);
  }

  return supabaseServiceClient;
};

const getSupabasePublicClient = () => {
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    return null;
  }

  if (!supabasePublicClient) {
    supabasePublicClient = buildClient(env.supabasePublishableKey);
  }

  return supabasePublicClient;
};

const testSupabaseConnection = async () => {
  const supabase = getSupabaseClient();

  if (!supabase) {
    const error = new Error('SUPABASE_SERVICE_ROLE_KEY no configurada. El backend no puede escribir en Supabase Storage.');
    error.statusCode = 500;
    error.errorCode = 'SUPABASE_SERVICE_ROLE_MISSING';
    logger.logError('SYSTEM', error.message);
    throw error;
  }

  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      throw error;
    }

    const detectedBuckets = (data || []).map((bucket) => bucket.name || bucket.id).filter(Boolean);
    const missingBuckets = env.requiredStorageBuckets.filter((bucketName) => !detectedBuckets.includes(bucketName));

    if (missingBuckets.length > 0) {
      const bucketError = new Error(`Faltan buckets requeridos de Storage: ${missingBuckets.join(', ')}`);
      bucketError.statusCode = 500;
      bucketError.errorCode = 'SUPABASE_STORAGE_BUCKETS_MISSING';
      bucketError.meta = {
        missingBuckets,
        detectedBuckets
      };
      throw bucketError;
    }

    logger.logInfo('SYSTEM', 'Conexion exitosa con Supabase (Storage validado)', {
      buckets: detectedBuckets
    });

    return {
      buckets: detectedBuckets
    };
  } catch (error) {
    logger.logError('SYSTEM', 'Error al verificar conexion con Supabase', error);
    throw error;
  }
};

module.exports = {
  getSupabaseClient,
  getSupabasePublicClient,
  testSupabaseConnection
};
