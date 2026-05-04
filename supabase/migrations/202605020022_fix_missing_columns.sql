-- ==========================================
-- 202605020022_fix_missing_columns.sql
-- ==========================================
-- Migración correctiva incremental para añadir columnas faltantes en tablas existentes

-- 1. Agregar columnas faltantes a request_types
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS requires_document BOOLEAN DEFAULT false;
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS affects_attendance BOOLEAN DEFAULT true;
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS affects_payroll BOOLEAN DEFAULT false;
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS max_days INTEGER;
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT true;
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.request_types ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Actualizar code temporal si es null
UPDATE public.request_types SET code = 'REQ_' || substr(id::text, 1, 6) WHERE code IS NULL;

-- 2. Agregar columnas faltantes a payroll_periods de acuerdo al sprint 6
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS generated_by UUID REFERENCES public.users(id);
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE);
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS month INTEGER DEFAULT EXTRACT(MONTH FROM CURRENT_DATE);
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id);
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.users(id);
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Quitar el constraint antiguo de status si existe para permitir los nuevos valores de sprint 6
ALTER TABLE public.payroll_periods DROP CONSTRAINT IF EXISTS chk_payroll_periods_status;

-- Actualizar default status a draft y datos existentes
ALTER TABLE public.payroll_periods ALTER COLUMN status SET DEFAULT 'draft';
UPDATE public.payroll_periods SET status = 'draft' WHERE status = 'OPEN';

-- 4. Asegurar que payroll_records tiene company_id
ALTER TABLE public.payroll_records ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- 5. Asignar permisos faltantes a TRABAJADOR para que pueda crear solicitudes
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name = 'TRABAJADOR' AND p.name IN ('requests.create', 'requests.read_own', 'vacations.request', 'medical_leaves.request')
ON CONFLICT DO NOTHING;

-- 6. Agregar days_requested a employee_requests
ALTER TABLE public.employee_requests ADD COLUMN IF NOT EXISTS days_requested INTEGER DEFAULT 1;

-- 7. Alinear columnas de user_devices (Solicitud del usuario)
ALTER TABLE public.user_devices
ADD COLUMN IF NOT EXISTS device_identifier TEXT,
ADD COLUMN IF NOT EXISTS device_name TEXT,
ADD COLUMN IF NOT EXISTS brand TEXT,
ADD COLUMN IF NOT EXISTS model TEXT,
ADD COLUMN IF NOT EXISTS os_version TEXT,
ADD COLUMN IF NOT EXISTS push_token TEXT,
ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_authorized BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Compatibilidad: si existe device_id, copiarlo a device_identifier cuando falte.
UPDATE public.user_devices
SET device_identifier = device_id
WHERE device_identifier IS NULL
  AND device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_company_id ON public.user_devices(company_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_device_id ON public.user_devices(device_id);
