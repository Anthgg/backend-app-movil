BEGIN;

UPDATE public.request_types
SET is_paid = FALSE,
    affects_payroll = TRUE,
    affects_attendance = TRUE,
    updated_at = NOW()
WHERE UPPER(COALESCE(code, name)) IN (
    'UNPAID_LEAVE',
    'PERSONAL_PERMISSION',
    'PERMISO_PERSONAL',
    'PERMISO',
    'PERM',
    'LEAVE_PERMISSION'
  )
  OR UPPER(COALESCE(name, code)) IN (
    'UNPAID_LEAVE',
    'PERSONAL_PERMISSION',
    'PERMISO_PERSONAL',
    'PERMISO PERSONAL',
    'PERMISO',
    'PERM',
    'LEAVE_PERMISSION'
  );

UPDATE public.request_types
SET is_paid = TRUE,
    affects_payroll = TRUE,
    affects_attendance = TRUE,
    updated_at = NOW()
WHERE UPPER(COALESCE(code, name)) IN (
    'VACATION',
    'VAC',
    'VACACIONES',
    'MEDICAL_LEAVE',
    'MEDICAL',
    'DESCANSO_MEDICO'
  )
  OR UPPER(COALESCE(name, code)) IN (
    'VACATION',
    'VAC',
    'VACACIONES',
    'MEDICAL_LEAVE',
    'MEDICAL',
    'DESCANSO_MEDICO',
    'DESCANSO MEDICO'
  );

COMMIT;
