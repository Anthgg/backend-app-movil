require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
    
    console.log('Intentando subir un archivo de prueba a request-documents...');
    
    const { data, error } = await supabase.storage
      .from('request-documents')
      .upload('test/test.txt', Buffer.from('test file'), {
        contentType: 'text/plain',
        upsert: true
      });
      
    if (error) {
      console.log('ERROR:', error);
    } else {
      console.log('EXITO:', data);
    }
  } catch(e) {
    console.error('Crash:', e);
  }
})();
