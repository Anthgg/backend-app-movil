CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

UPDATE public.roles
SET code = UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^A-Za-z0-9]+', '_', 'g'), '^_|_$', '', 'g')),
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND (code IS NULL OR BTRIM(code) = '')
  AND name IS NOT NULL
  AND BTRIM(name) <> '';

