-- Keep persisted attendance statuses aligned with mobile history and analytics.
-- Most rest/holiday rows are virtual in the API, but manual corrections/imports
-- can now persist those states without violating the check constraint.

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
    'leave_permission',
    'holiday',
    'holiday_worked',
    'rest_day',
    'early_exit',
    'no_schedule'
  ));

COMMENT ON COLUMN public.attendance_records.status IS
  'Daily attendance state. Includes worked days, leave states, holidays and rest days; absent remains an unjustified missed scheduled workday.';
