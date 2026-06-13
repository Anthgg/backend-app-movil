-- Formal labor schedules, shift assignments, attendance calculation snapshots.

CREATE TABLE IF NOT EXISTS public.company_labor_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  late_tolerance_minutes INTEGER NOT NULL DEFAULT 5,
  auto_absence_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_absence_after_time TIME WITHOUT TIME ZONE NOT NULL DEFAULT '23:59',
  default_shift_kind VARCHAR(30) NOT NULL DEFAULT 'with_break',
  default_effective_minutes INTEGER NOT NULL DEFAULT 480,
  default_break_minutes INTEGER NOT NULL DEFAULT 60,
  default_break_paid BOOLEAN NOT NULL DEFAULT false,
  weekly_target_minutes INTEGER NOT NULL DEFAULT 2880,
  working_days JSONB NOT NULL DEFAULT '["monday","tuesday","wednesday","thursday","friday","saturday"]'::jsonb,
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Lima',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT company_labor_policies_late_tolerance_check CHECK (late_tolerance_minutes >= 0 AND late_tolerance_minutes <= 180),
  CONSTRAINT company_labor_policies_effective_check CHECK (default_effective_minutes > 0),
  CONSTRAINT company_labor_policies_break_check CHECK (default_break_minutes >= 0),
  CONSTRAINT company_labor_policies_weekly_check CHECK (weekly_target_minutes > 0)
);

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS effective_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS break_paid BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_target_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(80),
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.shifts
  ALTER COLUMN tolerance_minutes SET DEFAULT 5;

UPDATE public.shifts
SET break_minutes = 0
WHERE break_minutes IS NULL;

WITH shift_presence AS (
  SELECT
    id,
    CASE
      WHEN start_time IS NULL OR end_time IS NULL THEN 480
      WHEN end_time > start_time THEN
        (EXTRACT(EPOCH FROM ((DATE '2000-01-01' + end_time) - (DATE '2000-01-01' + start_time))) / 60)::INTEGER
      ELSE
        (EXTRACT(EPOCH FROM ((DATE '2000-01-02' + end_time) - (DATE '2000-01-01' + start_time))) / 60)::INTEGER
    END AS presence_minutes
  FROM public.shifts
)
UPDATE public.shifts s
SET
  break_minutes = CASE
    WHEN s.break_minutes IS NULL OR s.break_minutes = 0 THEN GREATEST(sp.presence_minutes - 480, 0)
    ELSE s.break_minutes
  END,
  effective_minutes = COALESCE(
    s.effective_minutes,
    CASE
      WHEN COALESCE(s.break_paid, false) THEN sp.presence_minutes
      ELSE GREATEST(sp.presence_minutes - CASE
        WHEN s.break_minutes IS NULL OR s.break_minutes = 0 THEN GREATEST(sp.presence_minutes - 480, 0)
        ELSE s.break_minutes
      END, 0)
    END
  ),
  weekly_target_minutes = COALESCE(s.weekly_target_minutes, 2880),
  timezone = COALESCE(s.timezone, 'America/Lima'),
  status = COALESCE(s.status, CASE WHEN COALESCE(s.is_active, true) THEN 'active' ELSE 'inactive' END)
FROM shift_presence sp
WHERE sp.id = s.id;

CREATE TABLE IF NOT EXISTS public.worker_shift_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT worker_shift_assignments_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_worker_shift_assignments_active
  ON public.worker_shift_assignments(company_id, worker_id)
  WHERE is_active = true AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_worker_shift_assignments_worker_date
  ON public.worker_shift_assignments(worker_id, company_id, effective_from, effective_to);

INSERT INTO public.worker_shift_assignments (company_id, worker_id, shift_id, effective_from, is_active)
SELECT w.company_id, w.id, w.shift_id, COALESCE(w.hire_date, CURRENT_DATE), true
FROM public.workers w
WHERE w.shift_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.worker_shift_assignments wsa
    WHERE wsa.company_id = w.company_id
      AND wsa.worker_id = w.id
      AND wsa.is_active = true
      AND wsa.effective_to IS NULL
  );

INSERT INTO public.worker_shift_assignments (company_id, worker_id, shift_id, effective_from, is_active)
SELECT COALESCE(ws.company_id, w.company_id), ws.worker_id, ws.shift_id, COALESCE(ws.assigned_at::date, w.hire_date, CURRENT_DATE), true
FROM public.worker_shifts ws
JOIN public.workers w ON w.id = ws.worker_id
WHERE NOT EXISTS (
    SELECT 1
    FROM public.worker_shift_assignments wsa
    WHERE wsa.company_id = COALESCE(ws.company_id, w.company_id)
      AND wsa.worker_id = ws.worker_id
      AND wsa.is_active = true
      AND wsa.effective_to IS NULL
  )
ON CONFLICT DO NOTHING;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS labor_policy_id UUID REFERENCES public.company_labor_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS effective_worked_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS break_paid BOOLEAN,
  ADD COLUMN IF NOT EXISTS auto_absence_generated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS calculation_details JSONB;

CREATE INDEX IF NOT EXISTS idx_attendance_records_company_date
  ON public.attendance_records(company_id, date);

CREATE INDEX IF NOT EXISTS idx_attendance_records_policy
  ON public.attendance_records(labor_policy_id);

CREATE TABLE IF NOT EXISTS public.attendance_weekly_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  expected_minutes INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  effective_worked_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  proportional_factor NUMERIC(8,4) NOT NULL DEFAULT 1,
  salary_base NUMERIC(12,2) NOT NULL DEFAULT 0,
  hourly_rate NUMERIC(12,4) NOT NULL DEFAULT 0,
  absence_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  late_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_estimated_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  calculation_details JSONB,
  recalculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, worker_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_attendance_weekly_summaries_company_week
  ON public.attendance_weekly_summaries(company_id, week_start, week_end);

INSERT INTO public.permissions (id, name, description) VALUES
  (uuid_generate_v4(), 'shifts.manage', 'Crear, actualizar, desactivar y asignar turnos'),
  (uuid_generate_v4(), 'labor_policies.read', 'Leer politicas laborales'),
  (uuid_generate_v4(), 'labor_policies.manage', 'Administrar politicas laborales'),
  (uuid_generate_v4(), 'schedule.assignments.read', 'Leer asignaciones de horarios'),
  (uuid_generate_v4(), 'schedule.assignments.manage', 'Administrar asignaciones de horarios'),
  (uuid_generate_v4(), 'attendance.read', 'Leer asistencia de trabajadores'),
  (uuid_generate_v4(), 'jobs.execute', 'Ejecutar jobs operativos')
ON CONFLICT (name) DO NOTHING;

WITH schedule_permissions AS (
  SELECT id
  FROM public.permissions
  WHERE name IN (
    'shifts.read',
    'shifts.create',
    'shifts.update',
    'shifts.delete',
    'shifts.manage',
    'worker_shifts.assign',
    'worker_shifts.read',
    'labor_policies.read',
    'labor_policies.manage',
    'schedule.assignments.read',
    'schedule.assignments.manage',
    'attendance.read',
    'jobs.execute',
    'jobs.attendance.generate_absences',
    'jobs.attendance.close_incomplete',
    'jobs.attendance.detect_suspicious',
    'jobs.attendance.recalculate',
    'jobs.attendance.run_all'
  )
),
target_roles AS (
  SELECT id
  FROM public.roles
  WHERE deleted_at IS NULL
    AND UPPER(COALESCE(code, name)) IN ('ADMIN', 'RRHH')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT target_roles.id, schedule_permissions.id
FROM target_roles
CROSS JOIN schedule_permissions
ON CONFLICT DO NOTHING;
