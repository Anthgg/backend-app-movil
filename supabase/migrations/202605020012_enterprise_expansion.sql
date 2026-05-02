-- ==========================================
-- 1. MULTI-EMPRESA (MULTI-TENANT)
-- ==========================================
CREATE TABLE public.companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    ruc VARCHAR(20) UNIQUE NOT NULL,
    logo_url TEXT,
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Agregar company_id a tablas principales
ALTER TABLE public.users ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.roles ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.workers ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.projects ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.departments ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.job_positions ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.attendance_records ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.employee_requests ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- ==========================================
-- 2. CONFIGURACIÓN DE EMPRESA
-- ==========================================
CREATE TABLE public.company_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
    tardiness_tolerance_minutes INTEGER DEFAULT 15,
    default_geolocation_radius INTEGER DEFAULT 100,
    base_work_schedule JSONB, -- { start: '08:00', end: '17:00' }
    working_days JSONB, -- ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    permission_rules JSONB,
    vacation_rules JSONB,
    attendance_rules JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 3. HISTORIALES Y AUDITORÍAS DE ESTADO
-- ==========================================
CREATE TABLE public.user_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    old_status VARCHAR(30),
    new_status VARCHAR(30),
    changed_by UUID REFERENCES public.users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.worker_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    old_status VARCHAR(30),
    new_status VARCHAR(30),
    changed_by UUID REFERENCES public.users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.deleted_records_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    deleted_by UUID REFERENCES public.users(id),
    reason TEXT,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 4. NOTIFICACIONES
-- ==========================================
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL, -- REQUEST_APPROVED, MISSING_DOC, SYSTEM_ALERT
    is_read BOOLEAN DEFAULT false,
    channel VARCHAR(20) DEFAULT 'IN_APP', -- IN_APP, EMAIL, PUSH
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 5. CONTRATOS
-- ==========================================
CREATE TABLE public.contract_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.worker_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    contract_type_id UUID REFERENCES public.contract_types(id),
    start_date DATE NOT NULL,
    end_date DATE,
    agreed_salary NUMERIC(10, 2) NOT NULL,
    work_journey VARCHAR(100), -- Full-time, Part-time
    modality VARCHAR(50) DEFAULT 'PRESENCIAL', -- PRESENCIAL, REMOTO, HIBRIDO
    status VARCHAR(30) DEFAULT 'ACTIVE', -- ACTIVE, EXPIRED, TERMINATED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.contract_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID REFERENCES public.worker_contracts(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 6. TURNOS Y CALENDARIO LABORAL
-- ==========================================
CREATE TABLE public.shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    tolerance_minutes INTEGER DEFAULT 15,
    is_rotating BOOLEAN DEFAULT false,
    working_days JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.worker_shifts (
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY(worker_id, shift_id)
);

CREATE TABLE public.company_calendar (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    event_type VARCHAR(50), -- HOLIDAY, NON_WORKING, INTERNAL_EVENT
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.overtime_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    hours_calculated NUMERIC(5,2),
    hours_approved NUMERIC(5,2),
    approved_by UUID REFERENCES public.users(id),
    status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 7. GEOLOCALIZACIÓN Y DISPOSITIVOS
-- ==========================================
ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS gps_accuracy NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS device_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100),
ADD COLUMN IF NOT EXISTS is_mock_location BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS out_of_range BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_manual_correction BOOLEAN DEFAULT false;

CREATE TABLE public.user_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    model VARCHAR(100),
    os_version VARCHAR(50),
    push_token TEXT,
    is_authorized BOOLEAN DEFAULT false,
    is_blocked BOOLEAN DEFAULT false,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.attendance_evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    type VARCHAR(30), -- CHECK_IN, CHECK_OUT
    photo_url TEXT,
    server_time TIMESTAMP WITH TIME ZONE NOT NULL,
    device_time TIMESTAMP WITH TIME ZONE NOT NULL,
    time_difference_seconds INTEGER,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status VARCHAR(30) DEFAULT 'PENDING_VALIDATION',
    hr_comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 8. ACEPTACIÓN DE DOCUMENTOS DIGITALES
-- ==========================================
CREATE TABLE public.document_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    file_url TEXT,
    version VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.document_acceptances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    document_version_id UUID REFERENCES public.document_versions(id) ON DELETE CASCADE,
    accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address VARCHAR(100),
    device_info TEXT
);

-- ==========================================
-- 9. FLUJOS DE APROBACIÓN POR NIVELES
-- ==========================================
CREATE TABLE public.approval_flows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    module VARCHAR(50) NOT NULL, -- REQUESTS, OVERTIME, DOCUMENTS
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.approval_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flow_id UUID REFERENCES public.approval_flows(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    role_required VARCHAR(50) NOT NULL, -- SUPERVISOR, RRHH, ADMIN
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.request_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES public.employee_requests(id) ON DELETE CASCADE,
    step_id UUID REFERENCES public.approval_steps(id) ON DELETE CASCADE,
    status VARCHAR(30) DEFAULT 'PENDING', -- APPROVED, REJECTED, OBSERVED
    comment TEXT,
    acted_by UUID REFERENCES public.users(id),
    acted_at TIMESTAMP WITH TIME ZONE
);

-- ==========================================
-- 10. BACKUPS LOGS
-- ==========================================
CREATE TABLE public.backup_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_name VARCHAR(255) NOT NULL,
    status VARCHAR(30) DEFAULT 'IN_PROGRESS', -- SUCCESS, FAILED
    logs TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);
