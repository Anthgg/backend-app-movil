const { getSupabaseClient } = require('./src/config/supabase');

(async () => {
  const supabase = getSupabaseClient();
  const fileBuffer = Buffer.from('test');
  
  const { data, error } = await supabase.storage
    .from('fake-bucket-xyz')
    .upload('test.png', fileBuffer, {
      contentType: 'image/png',
      upsert: true
    });

  if (error) {
    console.log('Error properties:', Object.keys(error));
    console.log('Error status:', error.status);
    console.log('Error statusCode:', error.statusCode);
    console.log('Error message:', error.message);
    console.log('Full Error:', JSON.stringify(error, null, 2));
  } else {
    console.log('Success:', data);
  }
  process.exit(0);
})();
