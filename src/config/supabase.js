const { createClient } = require('@supabase/supabase-js');
const env = require('./env');
const logger = require('../shared/utils/logger');

let supabaseClient;

const getSupabaseClient = () => {
  if (!env.supabaseUrl || !env.supabaseKey) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(env.supabaseUrl, env.supabaseKey);
  }

  return supabaseClient;
};

const testSupabaseConnection = async () => {
  const supabase = getSupabaseClient();

  if (!supabase) {
    logger.logError('SYSTEM', 'SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY no configuradas; se omite la validación de Supabase');
    return false;
  }

  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
      throw error;
    }
    logger.logInfo('SYSTEM', 'Conexión exitosa con Supabase (Storage validado)');
    return true;
  } catch (error) {
    logger.logError('SYSTEM', 'Error al verificar conexión con Supabase', error);
    throw error;
  }
};

module.exports = {
  getSupabaseClient,
  testSupabaseConnection
};
