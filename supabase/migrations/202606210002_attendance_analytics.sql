-- Attendance analytics reads a daily worker/status matrix and returns chart-ready
-- aggregates. The request metadata column also stores vacation balance snapshots.

ALTER TABLE public.employee_requests
  ADD COLUMN IF NOT EXISTS metadata JSONB;

UPDATE public.employee_requests
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

ALTER TABLE public.employee_requests
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_analytics_company_date_status
  ON public.attendance_records (company_id, date, status, worker_id);

CREATE INDEX IF NOT EXISTS idx_attendance_analytics_worker_date
  ON public.attendance_records (company_id, worker_id, date);

CREATE INDEX IF NOT EXISTS idx_requests_analytics_worker_range
  ON public.employee_requests (company_id, worker_id, status, start_date, end_date, request_type_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workers_analytics_dimensions
  ON public.workers (
    company_id,
    area_id,
    internal_department_id,
    position_id,
    work_location_id
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crew_workers_analytics_range
  ON public.crew_workers (company_id, worker_id, crew_id, assigned_at, unassigned_at);

CREATE INDEX IF NOT EXISTS idx_worker_rest_days_analytics
  ON public.worker_rest_days (company_id, worker_id, date);

CREATE INDEX IF NOT EXISTS idx_worker_location_assignments_analytics_range
  ON public.worker_location_assignments (company_id, worker_id, start_date, end_date)
  WHERE cancelled_at IS NULL;

COMMENT ON COLUMN public.employee_requests.metadata IS
  'Request-specific snapshots and warnings, including vacation balance override information.';
