-- ==========================================
-- 1. TABLA JOB RUNS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.job_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    job_name VARCHAR(100) NOT NULL,
    status VARCHAR(30) DEFAULT 'running', -- running, success, failed, partial
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    triggered_by UUID REFERENCES public.users(id),
    trigger_type VARCHAR(30) DEFAULT 'automatic', -- automatic, manual
    target_date DATE,
    total_processed INTEGER DEFAULT 0,
    total_success INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. AMPLIAR ATTENDANCE RECORDS PARA DETECCIÓN DE FRAUDE E INCOMPLETOS
-- ==========================================
ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS is_suspicious BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS suspicious_reason TEXT,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS incomplete_reason TEXT,
ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_closed_at TIMESTAMP WITH TIME ZONE;

-- Añadir restricción única para evitar faltas o asistencias duplicadas por día y trabajador
-- Solo permitimos un registro por trabajador por día por empresa (simplificación).
CREATE UNIQUE INDEX IF NOT EXISTS unique_worker_date ON public.attendance_records(worker_id, company_id, ((check_in_time AT TIME ZONE 'UTC')::DATE));

-- ==========================================
-- 3. PERMISOS SPRINT 3.5
-- ==========================================
INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'jobs.attendance.generate_absences', 'Ejecutar generación de faltas'),
(uuid_generate_v4(), 'jobs.attendance.close_incomplete', 'Cerrar asistencias incompletas'),
(uuid_generate_v4(), 'jobs.attendance.detect_suspicious', 'Detectar asistencias sospechosas'),
(uuid_generate_v4(), 'jobs.attendance.recalculate', 'Recalcular asistencias'),
(uuid_generate_v4(), 'jobs.attendance.run_all', 'Ejecutar todos los jobs')
ON CONFLICT (name) DO NOTHING;
