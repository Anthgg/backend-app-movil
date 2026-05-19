const { query } = require('../src/config/database');

const createBucket = async () => {
  try {
    await query(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit)
      VALUES ('company-assets', 'company-assets', true, 5242880)
      ON CONFLICT (id) DO UPDATE SET public = true;
    `);

    // Storage policies
    await query(`
      DROP POLICY IF EXISTS "company_assets_select" ON storage.objects;
      CREATE POLICY "company_assets_select"
      ON storage.objects FOR SELECT
      TO public
      USING ( bucket_id = 'company-assets' );

      DROP POLICY IF EXISTS "company_assets_insert" ON storage.objects;
      CREATE POLICY "company_assets_insert"
      ON storage.objects FOR INSERT
      TO public
      WITH CHECK ( bucket_id = 'company-assets' );

      DROP POLICY IF EXISTS "company_assets_update" ON storage.objects;
      CREATE POLICY "company_assets_update"
      ON storage.objects FOR UPDATE
      TO public
      USING ( bucket_id = 'company-assets' );

      DROP POLICY IF EXISTS "company_assets_delete" ON storage.objects;
      CREATE POLICY "company_assets_delete"
      ON storage.objects FOR DELETE
      TO public
      USING ( bucket_id = 'company-assets' );
    `);

    console.log('Bucket company-assets created and policies set');
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
};

createBucket();
