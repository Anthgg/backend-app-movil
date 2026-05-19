require('dotenv').config({ path: '.env.production.local' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
  try {
    console.log('URL:', process.env.SUPABASE_URL);
    // Use the anon key to see what we can access
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
    
    console.log('Listando buckets con ANON KEY...');
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.error('Error listando buckets:', error);
    } else {
      console.log('Buckets encontrados:');
      buckets.forEach(b => console.log(` - ${b.name} (Public: ${b.public})`));
      
      const found = buckets.find(b => b.name === 'request-documents');
      if (!found) {
        console.log('\n❌ EL BUCKET request-documents NO SE VE CON LA ANON KEY!');
      } else {
        console.log('\n✅ El bucket request-documents EXISTE y es visible.');
      }
    }
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
