CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.work_locations
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.work_locations
  ALTER COLUMN allowed_radius_meters SET DEFAULT 100;

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS work_location_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_workers_work_location_id'
  ) THEN
    ALTER TABLE public.workers
      ADD CONSTRAINT fk_workers_work_location_id
      FOREIGN KEY (work_location_id) REFERENCES public.work_locations(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS work_location_id UUID REFERENCES public.work_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS check_in_allowed_radius_meters INTEGER,
  ADD COLUMN IF NOT EXISTS check_in_location_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS check_in_location_validation_message TEXT,
  ADD COLUMN IF NOT EXISTS check_in_device_info JSONB,
  ADD COLUMN IF NOT EXISTS check_in_server_time TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS check_out_allowed_radius_meters INTEGER,
  ADD COLUMN IF NOT EXISTS check_out_location_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS check_out_location_validation_message TEXT,
  ADD COLUMN IF NOT EXISTS check_out_device_info JSONB,
  ADD COLUMN IF NOT EXISTS check_out_server_time TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.attendance_location_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES public.workers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  work_location_id UUID REFERENCES public.work_locations(id) ON DELETE SET NULL,
  type VARCHAR(30) NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy NUMERIC(10,2),
  distance_meters NUMERIC(10,2),
  allowed_radius_meters INTEGER,
  is_location_valid BOOLEAN DEFAULT FALSE,
  validation_message TEXT,
  device_info JSONB,
  ip_address VARCHAR(100),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_locations_company_active
  ON public.work_locations(company_id, is_active) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workers_work_location
  ON public.workers(company_id, work_location_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_records_work_location
  ON public.attendance_records(company_id, work_location_id, date);

CREATE INDEX IF NOT EXISTS idx_attendance_location_attempts_worker
  ON public.attendance_location_attempts(company_id, worker_id, created_at DESC);

