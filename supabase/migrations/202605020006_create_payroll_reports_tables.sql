-- PAYROLL PERIODS
CREATE TABLE public.payroll_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL, -- Ej: Mayo 2026
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, CLOSED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PAYROLL RECORDS (Sueldos estimados)
CREATE TABLE public.payroll_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payroll_period_id UUID REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    base_salary NUMERIC(10, 2) DEFAULT 0,
    days_worked INTEGER DEFAULT 0,
    absences INTEGER DEFAULT 0,
    lates INTEGER DEFAULT 0,
    extra_hours NUMERIC(5, 2) DEFAULT 0,
    bonuses NUMERIC(10, 2) DEFAULT 0,
    deductions NUMERIC(10, 2) DEFAULT 0,
    net_estimated NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(payroll_period_id, worker_id)
);

CREATE TRIGGER update_payroll_records_modtime BEFORE UPDATE ON public.payroll_records FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
