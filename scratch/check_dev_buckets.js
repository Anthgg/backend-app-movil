require('dotenv').config({ path: '.env' }); // Usa el .env de DEV
const { createClient } = require('@supabase/supabase-js');

(async () => {
  try {
    console.log('Revisando bucket en proyecto DEV:', process.env.SUPABASE_URL);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
    
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.log('Error listando DEV buckets:', error.message);
    } else {
      const found = buckets.find(b => b.name === 'request-documents');
      if (found) {
        console.log('✅ El bucket request-documents SÍ existe en el proyecto DEV.');
      } else {
        console.log('❌ El bucket request-documents NO existe en el proyecto DEV.');
      }
    }
  } catch(e) {
    console.error(e);
  }
})();
