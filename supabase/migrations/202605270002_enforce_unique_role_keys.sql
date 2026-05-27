CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

UPDATE public.roles
SET code = UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^A-Za-z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE (code IS NULL OR TRIM(code) = '')
  AND name IS NOT NULL;

WITH ranked_roles AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, LOWER(COALESCE(NULLIF(code, ''), name))
           ORDER BY COALESCE(is_active, TRUE) DESC,
                    COALESCE(is_system_role, FALSE) DESC,
                    created_at ASC NULLS LAST,
                    id ASC
         ) AS rn
  FROM public.roles
  WHERE deleted_at IS NULL
)
UPDATE public.roles r
SET deleted_at = NOW(),
    is_active = FALSE,
    updated_at = NOW(),
    delete_reason = COALESCE(delete_reason, 'Duplicate role key cleanup')
FROM ranked_roles rr
WHERE rr.id = r.id
  AND rr.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_global_role_key_unique
  ON public.roles (LOWER(COALESCE(NULLIF(code, ''), name)))
  WHERE company_id IS NULL
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_company_role_key_unique
  ON public.roles (company_id, LOWER(COALESCE(NULLIF(code, ''), name)))
  WHERE company_id IS NOT NULL
    AND deleted_at IS NULL;
