require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

(async () => {
  try {
    console.log('Testing DEV project anon key:', process.env.SUPABASE_URL);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
    
    // Test auth login
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'admin.qa@demo.com',
      password: 'AdminDemo2026!'
    });
    
    if (error) {
      console.log('ERROR login:', error.message);
    } else {
      console.log('SUCCESS login! uuerlnam... is the real database!');
    }
  } catch(e) {
    console.error(e);
  }
})();
