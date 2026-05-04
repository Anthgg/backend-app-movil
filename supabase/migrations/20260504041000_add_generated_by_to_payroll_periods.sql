-- Agregar la columna generated_by a payroll_periods
ALTER TABLE public.payroll_periods
ADD COLUMN IF NOT EXISTS generated_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
