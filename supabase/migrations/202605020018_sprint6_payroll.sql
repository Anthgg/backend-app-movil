-- ==========================================
-- 1. PAYROLL SETTINGS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payroll_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
    monthly_days_base INTEGER DEFAULT 30,
    discount_late_enabled BOOLEAN DEFAULT true,
    discount_absence_enabled BOOLEAN DEFAULT true,
    overtime_enabled BOOLEAN DEFAULT true,
    overtime_multiplier NUMERIC(5,2) DEFAULT 1.25,
    currency VARCHAR(10) DEFAULT 'PEN',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. PAYROLL CONCEPTS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payroll_concepts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL, -- income, discount
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 3. PAYROLL PERIODS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payroll_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(30) DEFAULT 'draft', -- draft, generated, reviewed, approved, closed, cancelled
    generated_by UUID REFERENCES public.users(id),
    approved_by UUID REFERENCES public.users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    closed_by UUID REFERENCES public.users(id),
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, year, month)
);

-- ==========================================
-- 4. PAYROLL RECORDS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payroll_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    payroll_period_id UUID REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    base_salary NUMERIC(12,2) DEFAULT 0,
    daily_rate NUMERIC(12,2) DEFAULT 0,
    hourly_rate NUMERIC(12,2) DEFAULT 0,
    worked_days INTEGER DEFAULT 0,
    absent_days INTEGER DEFAULT 0,
    justified_absence_days INTEGER DEFAULT 0,
    vacation_days INTEGER DEFAULT 0,
    medical_leave_days INTEGER DEFAULT 0,
    permission_paid_days INTEGER DEFAULT 0,
    permission_unpaid_days INTEGER DEFAULT 0,
    late_minutes INTEGER DEFAULT 0,
    worked_minutes INTEGER DEFAULT 0,
    overtime_minutes INTEGER DEFAULT 0,
    gross_amount NUMERIC(12,2) DEFAULT 0,
    absence_discount NUMERIC(12,2) DEFAULT 0,
    late_discount NUMERIC(12,2) DEFAULT 0,
    unpaid_permission_discount NUMERIC(12,2) DEFAULT 0,
    overtime_amount NUMERIC(12,2) DEFAULT 0,
    bonus_amount NUMERIC(12,2) DEFAULT 0,
    adjustment_amount NUMERIC(12,2) DEFAULT 0,
    net_estimated_amount NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'draft',
    calculation_details JSONB,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(payroll_period_id, worker_id)
);

-- ==========================================
-- 5. PAYROLL RECORD ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payroll_record_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payroll_record_id UUID REFERENCES public.payroll_records(id) ON DELETE CASCADE,
    payroll_concept_id UUID REFERENCES public.payroll_concepts(id),
    type VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 6. PAYROLL ADJUSTMENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    payroll_record_id UUID REFERENCES public.payroll_records(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES public.workers(id),
    type VARCHAR(20) NOT NULL, -- income, discount
    concept VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    created_by UUID REFERENCES public.users(id),
    approved_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE
);

-- ==========================================
-- 7. PERMISOS SPRINT 6
-- ==========================================
INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'payroll.periods.create', 'Crear periodo de planilla'),
(uuid_generate_v4(), 'payroll.periods.read', 'Leer periodos de planilla'),
(uuid_generate_v4(), 'payroll.periods.generate', 'Generar planilla'),
(uuid_generate_v4(), 'payroll.periods.recalculate', 'Recalcular planilla'),
(uuid_generate_v4(), 'payroll.periods.approve', 'Aprobar planilla'),
(uuid_generate_v4(), 'payroll.periods.close', 'Cerrar planilla'),
(uuid_generate_v4(), 'payroll.periods.reopen', 'Reabrir planilla'),
(uuid_generate_v4(), 'payroll.records.read', 'Leer registros de planilla'),
(uuid_generate_v4(), 'payroll.records.review', 'Revisar registros'),
(uuid_generate_v4(), 'payroll.records.approve', 'Aprobar registros'),
(uuid_generate_v4(), 'payroll.adjustments.create', 'Crear ajustes'),
(uuid_generate_v4(), 'payroll.adjustments.approve', 'Aprobar ajustes'),
(uuid_generate_v4(), 'payroll.concepts.manage', 'Administrar conceptos'),
(uuid_generate_v4(), 'payroll.export', 'Exportar planilla')
ON CONFLICT (name) DO NOTHING;
