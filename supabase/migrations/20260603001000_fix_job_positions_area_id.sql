-- ============================================================
-- Fix: Backfill area_id in job_positions using code prefix
-- Problem: Some positions have NULL or wrong area_id causing
--          422 INVALID_POSITION on complete-profile endpoint.
-- Strategy: Match area by code prefix (e.g. "OPE-001" -> area.code = "OPE")
--           then fall back to matching by area_name from seed data.
-- ============================================================

-- Step 1: Update positions where area_id IS NULL using code prefix
UPDATE public.job_positions jp
SET area_id = a.id,
    updated_at = NOW()
FROM public.areas a
WHERE jp.company_id = a.company_id
  AND jp.deleted_at IS NULL
  AND a.deleted_at IS NULL
  AND jp.area_id IS NULL
  AND jp.code IS NOT NULL
  AND UPPER(a.code) = UPPER(SPLIT_PART(jp.code, '-', 1));

-- Step 2: Update positions where area_id is set but points to a wrong area
--         (detected by code prefix mismatch). Re-link to the correct area.
UPDATE public.job_positions jp
SET area_id = correct_area.id,
    updated_at = NOW()
FROM public.areas correct_area
WHERE jp.company_id = correct_area.company_id
  AND jp.deleted_at IS NULL
  AND correct_area.deleted_at IS NULL
  AND jp.area_id IS NOT NULL
  AND jp.code IS NOT NULL
  AND UPPER(correct_area.code) = UPPER(SPLIT_PART(jp.code, '-', 1))
  AND jp.area_id <> correct_area.id;

-- Step 3: For positions still without area_id, try matching by name convention
--         from the original seed (area_name embedded in position name or description)
--         This handles positions that may not follow the code prefix convention.
UPDATE public.job_positions jp
SET area_id = a.id,
    updated_at = NOW()
FROM public.areas a
WHERE jp.company_id = a.company_id
  AND jp.deleted_at IS NULL
  AND a.deleted_at IS NULL
  AND jp.area_id IS NULL
  AND (
    jp.description ILIKE '%' || a.name || '%'
    OR jp.name ILIKE '%' || a.name || '%'
  );

-- Diagnostic: Report positions still without a valid area_id after fixes
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO orphan_count
  FROM public.job_positions
  WHERE area_id IS NULL
    AND deleted_at IS NULL;

  IF orphan_count > 0 THEN
    RAISE WARNING 'ATTENTION: % job_position(s) still have NULL area_id after backfill. Manual review required.', orphan_count;
  ELSE
    RAISE NOTICE 'OK: All active job_positions have a valid area_id.';
  END IF;
END $$;
