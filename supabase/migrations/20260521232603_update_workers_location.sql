-- Migration: Add Ubigeo foreign keys to 'workers'

-- The old 'department_id' was renamed to 'area_id' in migration 20260521232601.
-- Now we safely add the new geographical IDs.

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS province_id UUID REFERENCES public.provinces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS district_id UUID REFERENCES public.districts(id) ON DELETE SET NULL;

-- The 'address' column already exists in the 'workers' table as TEXT.
-- We can also create indexes for the new geographical foreign keys.
CREATE INDEX IF NOT EXISTS idx_workers_department_id ON public.workers(department_id);
CREATE INDEX IF NOT EXISTS idx_workers_province_id ON public.workers(province_id);
CREATE INDEX IF NOT EXISTS idx_workers_district_id ON public.workers(district_id);
