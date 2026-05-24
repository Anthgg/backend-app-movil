-- Migration: Add department_id and role_id to areas table
-- Date: 2026-05-24
-- Description: Allows associating an area to a department and an existing role

-- Step 1: Add columns (nullable so existing rows are not affected)
ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS department_id UUID NULL REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS role_id       UUID NULL REFERENCES roles(id);

-- Step 2: Unique index to prevent duplicate area names per company (case-insensitive)
-- Using a partial index to exclude soft-deleted rows
CREATE UNIQUE INDEX IF NOT EXISTS areas_company_name_unique
  ON areas (company_id, LOWER(name))
  WHERE deleted_at IS NULL;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'areas'
ORDER BY ordinal_position;
