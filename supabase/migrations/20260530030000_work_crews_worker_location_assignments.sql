CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.work_crews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  supervisor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  work_location_id UUID NOT NULL REFERENCES public.work_locations(id) ON DELETE RESTRICT,
  is_active BOOLEAN DEFAULT TRUE,
  status BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_work_crews_company_name_active
  ON public.work_crews(company_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_crews_company_supervisor
  ON public.work_crews(company_id, supervisor_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.crew_workers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  crew_id UUID NOT NULL REFERENCES public.work_crews(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  unassigned_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_crew_workers_one_active_crew
  ON public.crew_workers(company_id, worker_id)
  WHERE is_active = TRUE AND unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crew_workers_crew_active
  ON public.crew_workers(company_id, crew_id, is_active);

CREATE TABLE IF NOT EXISTS public.worker_location_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  work_location_id UUID NOT NULL REFERENCES public.work_locations(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assignment_type VARCHAR(20) NOT NULL CHECK (assignment_type IN ('temporary', 'permanent')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  reason TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancelled_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_worker_location_one_active_permanent
  ON public.worker_location_assignments(company_id, worker_id)
  WHERE is_active = TRUE AND assignment_type = 'permanent';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ex_worker_location_no_temp_overlap'
  ) THEN
    ALTER TABLE public.worker_location_assignments
      ADD CONSTRAINT ex_worker_location_no_temp_overlap
      EXCLUDE USING gist (
        company_id WITH =,
        worker_id WITH =,
        daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') WITH &&
      )
      WHERE (is_active = TRUE AND assignment_type = 'temporary');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_worker_location_assignments_active
  ON public.worker_location_assignments(company_id, worker_id, assignment_type, start_date, end_date)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.worker_assignment_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES public.workers(id) ON DELETE SET NULL,
  previous_work_location_id UUID REFERENCES public.work_locations(id) ON DELETE SET NULL,
  new_work_location_id UUID REFERENCES public.work_locations(id) ON DELETE SET NULL,
  previous_crew_id UUID REFERENCES public.work_crews(id) ON DELETE SET NULL,
  new_crew_id UUID REFERENCES public.work_crews(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES public.worker_location_assignments(id) ON DELETE SET NULL,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  change_type VARCHAR(50) NOT NULL,
  assignment_type VARCHAR(20),
  start_date DATE,
  end_date DATE,
  reason TEXT,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_assignment_history_worker
  ON public.worker_assignment_history(company_id, worker_id, changed_at DESC);

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS check_in_assignment_source VARCHAR(50),
  ADD COLUMN IF NOT EXISTS check_out_assignment_source VARCHAR(50),
  ADD COLUMN IF NOT EXISTS check_in_validation_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS check_out_validation_status VARCHAR(50);
