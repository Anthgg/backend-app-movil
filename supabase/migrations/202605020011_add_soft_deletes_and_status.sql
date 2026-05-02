-- 1. MODIFICAR USERS
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- 2. MODIFICAR WORKERS
ALTER TABLE public.workers
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS employment_status VARCHAR(30) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- 3. AÑADIR DELETION A OTRAS TABLAS PRINCIPALES
ALTER TABLE public.job_positions 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id), ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.departments 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id), ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id), ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.work_schedules 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id), ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.employee_requests 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id), ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id), ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE public.payroll_records 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id), ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- 4. TABLA LOGS DNI
CREATE TABLE public.dni_lookup_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dni VARCHAR(8) NOT NULL,
    requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    provider VARCHAR(100),
    success BOOLEAN DEFAULT false,
    response_status VARCHAR(50),
    error_message TEXT,
    ip_address VARCHAR(100),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.dni_lookup_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura auditoria DNI" ON public.dni_lookup_logs FOR SELECT USING (auth.role() = 'authenticated');

-- 5. INSERTAR PERMISOS GRANULARES
INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'users.create', 'Crear usuarios'),
(uuid_generate_v4(), 'users.read', 'Leer usuarios'),
(uuid_generate_v4(), 'users.update', 'Actualizar usuarios'),
(uuid_generate_v4(), 'users.delete', 'Eliminar usuarios'),
(uuid_generate_v4(), 'users.disable', 'Desactivar usuarios'),
(uuid_generate_v4(), 'users.enable', 'Activar usuarios'),
(uuid_generate_v4(), 'workers.create', 'Crear trabajadores'),
(uuid_generate_v4(), 'workers.read', 'Leer trabajadores'),
(uuid_generate_v4(), 'workers.update', 'Actualizar trabajadores'),
(uuid_generate_v4(), 'workers.disable', 'Desactivar trabajadores'),
(uuid_generate_v4(), 'workers.lookup_dni', 'Consultar DNI externo')
ON CONFLICT (name) DO NOTHING;
