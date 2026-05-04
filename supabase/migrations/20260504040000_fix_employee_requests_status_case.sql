-- Corregir el valor DEFAULT de status en employee_requests para que sea lowercase y coincida con la CHECK constraint
ALTER TABLE public.employee_requests
ALTER COLUMN status SET DEFAULT 'pending';

-- Actualizar registros existentes con status en mayúsculas
UPDATE public.employee_requests
SET status = LOWER(status)
WHERE status ~ '^[A-Z]';
