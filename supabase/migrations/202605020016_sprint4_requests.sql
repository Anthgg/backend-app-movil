-- ==========================================
-- 1. TIPOS DE SOLICITUDES
-- ==========================================
CREATE TABLE IF NOT EXISTS public.request_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    requires_document BOOLEAN DEFAULT false,
    requires_approval BOOLEAN DEFAULT true,
    affects_attendance BOOLEAN DEFAULT true,
    affects_payroll BOOLEAN DEFAULT false,
    max_days INTEGER,
    is_paid BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. SOLICITUDES (EMPLOYEE REQUESTS)
-- ==========================================
-- Si la tabla existe, la ajustamos. Asumo que ya existe por el sprint 1, pero agrego columnas por si acaso.
CREATE TABLE IF NOT EXISTS public.employee_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    request_type_id UUID REFERENCES public.request_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    reason TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'pending', -- draft, pending, pending_supervisor, pending_rrhh, observed, approved, rejected, cancelled
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 3. VACACIONES Y BALANCES
-- ==========================================
CREATE TABLE IF NOT EXISTS public.leave_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    accrued_days NUMERIC(5,2) DEFAULT 0,
    used_days NUMERIC(5,2) DEFAULT 0,
    pending_days NUMERIC(5,2) DEFAULT 0,
    available_days NUMERIC(5,2) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vacations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    request_id UUID REFERENCES public.employee_requests(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days NUMERIC(5,2) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    approved_by UUID REFERENCES public.users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 4. DESCANSOS MÉDICOS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.medical_leaves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    request_id UUID REFERENCES public.employee_requests(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    diagnosis_summary TEXT,
    medical_center VARCHAR(200),
    doctor_name VARCHAR(150),
    document_url TEXT,
    status VARCHAR(30) DEFAULT 'pending',
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 5. DOCUMENTOS DE SOLICITUD
-- ==========================================
CREATE TABLE IF NOT EXISTS public.request_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    request_id UUID REFERENCES public.employee_requests(id) ON DELETE CASCADE,
    document_type VARCHAR(50),
    file_url TEXT NOT NULL,
    file_path TEXT,
    mime_type VARCHAR(50),
    file_size INTEGER,
    status VARCHAR(30) DEFAULT 'pending',
    observation TEXT,
    uploaded_by UUID REFERENCES public.users(id),
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 6. PERMISOS SPRINT 4
-- ==========================================
INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'requests.create', 'Crear solicitud'),
(uuid_generate_v4(), 'requests.read_own', 'Ver propias solicitudes'),
(uuid_generate_v4(), 'requests.read_company', 'Ver solicitudes empresa'),
(uuid_generate_v4(), 'requests.approve', 'Aprobar solicitud'),
(uuid_generate_v4(), 'requests.reject', 'Rechazar solicitud'),
(uuid_generate_v4(), 'requests.observe', 'Observar solicitud'),
(uuid_generate_v4(), 'requests.cancel', 'Cancelar solicitud'),
(uuid_generate_v4(), 'vacations.request', 'Solicitar vacaciones'),
(uuid_generate_v4(), 'vacations.approve', 'Aprobar vacaciones'),
(uuid_generate_v4(), 'medical_leaves.request', 'Solicitar descanso medico')
ON CONFLICT (name) DO NOTHING;
