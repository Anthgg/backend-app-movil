-- Approved leave states are not absences. ABSENT remains reserved for an
-- unjustified missed scheduled workday.

UPDATE public.request_types
SET code = CASE
  WHEN UPPER(COALESCE(code, name)) IN ('VAC', 'VACATION', 'VACACIONES') THEN 'VACATION'
  WHEN UPPER(COALESCE(code, name)) IN ('MEDICAL', 'MEDICAL_LEAVE', 'DESCANSO_MEDICO') THEN 'MEDICAL_LEAVE'
  WHEN UPPER(COALESCE(code, name)) IN ('UNPAID_LEAVE', 'PERSONAL_PERMISSION', 'PERMISO_PERSONAL', 'LEAVE_PERMISSION') THEN 'UNPAID_LEAVE'
  ELSE code
END,
affects_attendance = CASE
  WHEN UPPER(COALESCE(code, name)) IN (
    'VAC', 'VACATION', 'VACACIONES',
    'MEDICAL', 'MEDICAL_LEAVE', 'DESCANSO_MEDICO',
    'UNPAID_LEAVE', 'PERSONAL_PERMISSION', 'PERMISO_PERSONAL', 'LEAVE_PERMISSION'
  ) THEN TRUE
  ELSE affects_attendance
END,
affects_payroll = CASE
  WHEN UPPER(COALESCE(code, name)) IN (
    'VAC', 'VACATION', 'VACACIONES',
    'MEDICAL', 'MEDICAL_LEAVE', 'DESCANSO_MEDICO',
    'UNPAID_LEAVE', 'PERSONAL_PERMISSION', 'PERMISO_PERSONAL', 'LEAVE_PERMISSION'
  ) THEN TRUE
  ELSE affects_payroll
END;

CREATE INDEX IF NOT EXISTS idx_employee_requests_approved_attendance_range
  ON public.employee_requests (company_id, worker_id, start_date, end_date, request_type_id)
  WHERE LOWER(status) = 'approved';

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_attendance_status;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_attendance_status CHECK (status IN (
    'present',
    'late',
    'absent',
    'incomplete',
    'out_of_range',
    'observed',
    'rejected',
    'corrected',
    'justified_absence',
    'vacation',
    'medical_leave',
    'unpaid_leave',
    'leave_permission'
  ));

COMMENT ON COLUMN public.attendance_records.status IS
  'Daily attendance state. absent means only unjustified absence; approved vacation, medical leave and unpaid leave are distinct states.';
