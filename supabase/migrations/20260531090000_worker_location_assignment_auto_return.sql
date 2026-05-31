ALTER TABLE public.worker_location_assignments
  ADD COLUMN IF NOT EXISTS auto_return BOOLEAN DEFAULT FALSE;
