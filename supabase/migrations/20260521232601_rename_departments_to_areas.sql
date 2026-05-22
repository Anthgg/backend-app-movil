-- Migration: Rename 'departments' to 'areas' and update 'job_positions'

-- 1. Rename the main table
ALTER TABLE IF EXISTS public.departments RENAME TO areas;

-- 2. Rename columns that reference the old 'departments' table
DO $$
BEGIN
  -- In job_positions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='job_positions' AND column_name='department_id') THEN
    ALTER TABLE public.job_positions RENAME COLUMN department_id TO area_id;
  END IF;

  -- In workers: area_id already exists, so we just drop department_id to make room for the new geographical one later
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workers' AND column_name='department_id') THEN
    ALTER TABLE public.workers DROP COLUMN department_id;
  END IF;
  
  -- In job_positions (rename title to name)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='job_positions' AND column_name='title') THEN
    ALTER TABLE public.job_positions RENAME COLUMN title TO name;
  END IF;
END $$;

-- 3. Add new columns to 'areas'
ALTER TABLE public.areas
  ADD COLUMN IF NOT EXISTS code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS status BOOLEAN DEFAULT TRUE;

-- 4. Add new columns to 'job_positions'
ALTER TABLE public.job_positions
  ADD COLUMN IF NOT EXISTS code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS level INTEGER,
  ADD COLUMN IF NOT EXISTS default_role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status BOOLEAN DEFAULT TRUE;

-- 5. Handle Unique Constraints for 'areas'
DO $$
DECLARE
  constraint_name text;
BEGIN
  -- Drop existing unique constraint on name if it exists (e.g., departments_name_key)
  FOR constraint_name IN (
    SELECT conname 
    FROM pg_constraint 
    WHERE conrelid = 'public.areas'::regclass 
      AND contype = 'u' 
      AND (
        conname LIKE '%name%' OR conname LIKE 'departments_%' OR conname LIKE 'areas_%'
      )
  )
  LOOP
    EXECUTE 'ALTER TABLE public.areas DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name);
  END LOOP;
END $$;

-- Create unique constraints scoped by company
CREATE UNIQUE INDEX IF NOT EXISTS idx_areas_unique_name_company 
  ON public.areas(company_id, LOWER(name)) 
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_areas_unique_code_company 
  ON public.areas(company_id, LOWER(code)) 
  WHERE deleted_at IS NULL AND code IS NOT NULL;

-- 6. Handle Unique Constraints for 'job_positions'
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_positions_unique_name_area
  ON public.job_positions(company_id, area_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_positions_unique_code_company
  ON public.job_positions(company_id, LOWER(code))
  WHERE deleted_at IS NULL AND code IS NOT NULL;
