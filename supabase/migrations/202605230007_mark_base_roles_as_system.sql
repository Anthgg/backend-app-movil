UPDATE public.roles
SET is_system_role = TRUE,
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND UPPER(COALESCE(code, name)) IN (
    'ADMIN',
    'RRHH',
    'SUPERVISOR',
    'TRABAJADOR',
    'LOGISTICA',
    'CONTABILIDAD',
    'GERENCIA',
    'SEGURIDAD',
    'SISTEMAS'
  );
