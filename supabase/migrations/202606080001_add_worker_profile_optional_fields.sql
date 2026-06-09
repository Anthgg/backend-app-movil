ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(80),
  ADD COLUMN IF NOT EXISTS modality VARCHAR(80),
  ADD COLUMN IF NOT EXISTS cost_center VARCHAR(120);

COMMENT ON COLUMN public.workers.emergency_contact_relationship IS 'Parentesco del contacto de emergencia del trabajador.';
COMMENT ON COLUMN public.workers.modality IS 'Modalidad laboral mostrada en el perfil del trabajador.';
COMMENT ON COLUMN public.workers.cost_center IS 'Centro de costo asociado al trabajador.';
