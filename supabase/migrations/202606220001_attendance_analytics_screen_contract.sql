-- Backend support for /dashboard/schedule/analytics.
-- The API computes KPIs/rankings/charts server-side and stores recalculation runs.

CREATE TABLE IF NOT EXISTS public.attendance_analytics_recalculations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  affected_workers INTEGER NOT NULL DEFAULT 0,
  affected_days INTEGER NOT NULL DEFAULT 0,
  recalculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_analytics_recalculations_company_period
  ON public.attendance_analytics_recalculations (company_id, start_date, end_date, recalculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_analytics_records_location_date
  ON public.attendance_records (company_id, work_location_id, date)
  WHERE work_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_analytics_records_status_date
  ON public.attendance_records (company_id, status, date, worker_id);

CREATE INDEX IF NOT EXISTS idx_workers_analytics_search
  ON public.workers (company_id, document_number, first_name, paternal_last_name, maternal_last_name)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.attendance_analytics_recalculations IS
  'Audit trail for attendance analytics recalculation runs requested from HR/Admin analytics.';
