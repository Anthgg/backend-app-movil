-- Migración para añadir campos de perfil extendidos a la tabla workers
ALTER TABLE public.workers 
ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS birth_date DATE,
ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20);

-- Comentarios para documentación
COMMENT ON COLUMN public.workers.personal_email IS 'Correo electrónico personal del trabajador';
COMMENT ON COLUMN public.workers.birth_date IS 'Fecha de nacimiento para cálculo de cumpleaños';
COMMENT ON COLUMN public.workers.emergency_contact_name IS 'Nombre de la persona de contacto en caso de emergencia';
COMMENT ON COLUMN public.workers.emergency_contact_phone IS 'Teléfono de la persona de contacto en caso de emergencia';
