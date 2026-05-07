-- Migración para añadir turnos y campos avanzados de asistencia
-- Tabla de turnos
CREATE TABLE IF NOT EXISTS public.shifts (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES public.companies(id),
    name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    tolerance_minutes INTEGER DEFAULT 0,
    allows_overtime BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Añadir shift_id a la tabla workers si no existe
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workers' AND column_name = 'shift_id') THEN
        ALTER TABLE public.workers ADD COLUMN shift_id INTEGER REFERENCES public.shifts(id);
    END IF;
END $$;

-- Añadir campos avanzados a attendance_records
DO $$ 
BEGIN 
    -- scheduled_check_in
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'scheduled_check_in') THEN
        ALTER TABLE public.attendance_records ADD COLUMN scheduled_check_in TIME;
    END IF;
    -- scheduled_check_out
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'scheduled_check_out') THEN
        ALTER TABLE public.attendance_records ADD COLUMN scheduled_check_out TIME;
    END IF;
    -- tolerance_minutes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'tolerance_minutes') THEN
        ALTER TABLE public.attendance_records ADD COLUMN tolerance_minutes INTEGER DEFAULT 0;
    END IF;
    -- early_leave_minutes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'early_leave_minutes') THEN
        ALTER TABLE public.attendance_records ADD COLUMN early_leave_minutes INTEGER DEFAULT 0;
    END IF;
    -- attendance_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'attendance_status') THEN
        ALTER TABLE public.attendance_records ADD COLUMN attendance_status VARCHAR(50);
    END IF;
    -- final_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'final_status') THEN
        ALTER TABLE public.attendance_records ADD COLUMN final_status VARCHAR(50);
    END IF;
END $$;

-- Asegurar que la tabla workers tenga los campos de perfil si faltaran
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workers' AND column_name = 'profile_photo_url') THEN
        ALTER TABLE public.workers ADD COLUMN profile_photo_url TEXT;
    END IF;
END $$;

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_attendance_worker_date ON public.attendance_records(worker_id, date);
CREATE INDEX IF NOT EXISTS idx_workers_shift_id ON public.workers(shift_id);
CREATE INDEX IF NOT EXISTS idx_shifts_active ON public.shifts(is_active);

-- Comentarios para documentación
COMMENT ON TABLE public.shifts IS 'Tabla para gestionar los turnos laborales de los trabajadores';
COMMENT ON COLUMN public.attendance_records.attendance_status IS 'Estado inicial de la marcación (on_time, tolerance, late, absent)';
COMMENT ON COLUMN public.attendance_records.final_status IS 'Estado final tras marcar salida (completed, early_leave, completed_overtime)';
