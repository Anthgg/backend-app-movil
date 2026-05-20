const env = require('../src/config/env');
const { getSupabaseClient } = require('../src/config/supabase');

const bucketDefinitions = [
  {
    name: env.companyAssetsBucket,
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml']
  },
  {
    name: env.requestDocumentsBucket,
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp'
    ]
  },
  {
    name: env.attendancePhotosBucket,
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  }
];

const ensureBucket = async (supabase, existingBuckets, bucket) => {
  const current = existingBuckets.find((item) => item.name === bucket.name || item.id === bucket.name);
  const bucketConfig = {
    public: bucket.public,
    fileSizeLimit: bucket.fileSizeLimit,
    allowedMimeTypes: bucket.allowedMimeTypes
  };

  if (!current) {
    const { error } = await supabase.storage.createBucket(bucket.name, bucketConfig);
    if (error) {
      throw new Error(`No se pudo crear el bucket '${bucket.name}': ${error.message}`);
    }
    console.log(`+ Bucket creado: ${bucket.name}`);
    return;
  }

  const { error } = await supabase.storage.updateBucket(bucket.name, bucketConfig);
  if (error) {
    throw new Error(`No se pudo actualizar el bucket '${bucket.name}': ${error.message}`);
  }

  console.log(`= Bucket verificado: ${bucket.name}`);
};

const run = async () => {
  env.validateEnv();

  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada. No se puede provisionar Supabase Storage.');
  }

  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(`No se pudieron listar los buckets de Supabase: ${error.message}`);
  }

  for (const bucket of bucketDefinitions) {
    await ensureBucket(supabase, buckets || [], bucket);
  }

  console.log('\nStorage listo.');
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
