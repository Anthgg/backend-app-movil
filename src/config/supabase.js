const { createClient } = require('@supabase/supabase-js');
const env = require('./env');
const logger = require('../shared/utils/logger');

const supabase = createClient(env.supabaseUrl, env.supabaseKey);

const testSupabaseConnection = async () => {
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
  supabase,
  testSupabaseConnection
};
