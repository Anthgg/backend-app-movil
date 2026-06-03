-- ============================================================
-- Fix: Link or soft-delete legacy job_positions with NULL code
--      that also have NULL area_id (duplicates from early seeds).
--
-- These records: Albañil, Operario, Supervisor de Obra (no code)
-- are duplicates of OBR-006, OBR-002, OPE-002 / OBR-004.
--
-- Strategy:
--   1. Try to link them to the correct area using name matching.
--   2. If a duplicate with a code already exists for the same
--      company+area+name, soft-delete the codeless duplicate.
-- ============================================================

DO $$
DECLARE
  rec RECORD;
  matched_area_id UUID;
BEGIN
  FOR rec IN
    SELECT jp.id, jp.name, jp.company_id
    FROM public.job_positions jp
    WHERE jp.code IS NULL
      AND jp.area_id IS NULL
      AND jp.deleted_at IS NULL
  LOOP
    -- Try to find an area whose name is related to the position name
    SELECT a.id INTO matched_area_id
    FROM public.areas a
    WHERE a.company_id = rec.company_id
      AND a.deleted_at IS NULL
      AND (
        -- Albañil, Operario, Ayudante, etc. -> Obra / Construccion
        (rec.name ILIKE '%albanil%'   OR rec.name ILIKE '%operario%' OR
         rec.name ILIKE '%peon%'      OR rec.name ILIKE '%soldador%' OR
         rec.name ILIKE '%pintor%'    OR rec.name ILIKE '%gasfiter%' OR
         rec.name ILIKE '%electricista%' OR rec.name ILIKE '%ayudante%')
        AND a.name ILIKE '%Obra%'
      )
      OR (
        -- Supervisor de Obra -> Operaciones
        rec.name ILIKE '%supervisor%'
        AND a.name ILIKE '%Operacion%'
      )
    LIMIT 1;

    IF matched_area_id IS NOT NULL THEN
      -- Check if a coded duplicate already exists for the same area+name
      PERFORM 1
      FROM public.job_positions dup
      WHERE dup.company_id = rec.company_id
        AND dup.area_id = matched_area_id
        AND LOWER(dup.name) = LOWER(rec.name)
        AND dup.code IS NOT NULL
        AND dup.deleted_at IS NULL
        AND dup.id <> rec.id;

      IF FOUND THEN
        -- Soft-delete the codeless duplicate (the coded one is the authoritative record)
        UPDATE public.job_positions
        SET deleted_at = NOW(),
            is_active  = FALSE,
            status     = FALSE,
            updated_at = NOW()
        WHERE id = rec.id;

        RAISE NOTICE 'Soft-deleted legacy duplicate: % (id: %)', rec.name, rec.id;
      ELSE
        -- No coded duplicate found, link this record to the matched area
        UPDATE public.job_positions
        SET area_id    = matched_area_id,
            updated_at = NOW()
        WHERE id = rec.id;

        RAISE NOTICE 'Linked % (id: %) to area %', rec.name, rec.id, matched_area_id;
      END IF;
    ELSE
      RAISE WARNING 'Could not resolve area for position: % (id: %)', rec.name, rec.id;
    END IF;
  END LOOP;
END $$;

-- Final count
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM public.job_positions
  WHERE area_id IS NULL AND deleted_at IS NULL;

  IF remaining > 0 THEN
    RAISE WARNING '% job_position(s) still have NULL area_id. Manual fix required.', remaining;
  ELSE
    RAISE NOTICE 'OK: All active job_positions now have a valid area_id.';
  END IF;
END $$;
