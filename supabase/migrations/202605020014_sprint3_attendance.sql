-- ==========================================
-- 1. TABLA ATTENDANCE CORRECTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    corrected_by UUID REFERENCES public.users(id),
    old_data JSONB,
    new_data JSONB,
    reason TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'pending', -- pending, approved, rejected, applied
    approved_by UUID REFERENCES public.users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. AMPLIAR ATTENDANCE RECORDS
-- ==========================================
ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS check_in_ip_address VARCHAR(100),
ADD COLUMN IF NOT EXISTS check_in_user_agent TEXT,
ADD COLUMN IF NOT EXISTS check_in_photo_url TEXT,
ADD COLUMN IF NOT EXISTS check_in_distance_meters NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS check_out_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS check_out_latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS check_out_longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS check_out_gps_accuracy NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS check_out_device_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS check_out_ip_address VARCHAR(100),
ADD COLUMN IF NOT EXISTS check_out_user_agent TEXT,
ADD COLUMN IF NOT EXISTS check_out_photo_url TEXT,
ADD COLUMN IF NOT EXISTS check_out_is_mock_location BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS check_out_out_of_range BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS check_out_distance_meters NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS worked_minutes INTEGER,
ADD COLUMN IF NOT EXISTS worked_hours NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER,
ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id),
ADD COLUMN IF NOT EXISTS schedule_id UUID,
ADD COLUMN IF NOT EXISTS late_minutes INTEGER;

-- Renombrar columnas existentes si es necesario para mantener convenciones
-- Pero lo manejaremos desde el backend para no romper compatibilidad.
-- is_mock_location -> check_in_is_mock_location
ALTER TABLE public.attendance_records RENAME COLUMN is_mock_location TO check_in_is_mock_location;
ALTER TABLE public.attendance_records RENAME COLUMN out_of_range TO check_in_out_of_range;
ALTER TABLE public.attendance_records RENAME COLUMN gps_accuracy TO check_in_gps_accuracy;
ALTER TABLE public.attendance_records RENAME COLUMN device_id TO check_in_device_id;

-- ==========================================
-- 3. PERMISOS SPRINT 3
-- ==========================================
INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'attendance.check_in', 'Marcar entrada'),
(uuid_generate_v4(), 'attendance.check_out', 'Marcar salida'),
(uuid_generate_v4(), 'attendance.read_own', 'Leer asistencia propia'),
(uuid_generate_v4(), 'attendance.read_company', 'Leer asistencia empresa'),
(uuid_generate_v4(), 'attendance.read_project', 'Leer asistencia proyecto'),
(uuid_generate_v4(), 'attendance.correct', 'Corregir asistencia'),
(uuid_generate_v4(), 'attendance.delete', 'Eliminar asistencia'),
(uuid_generate_v4(), 'attendance.generate_absences', 'Generar faltas estimadas'),
(uuid_generate_v4(), 'attendance.review_evidence', 'Revisar evidencia')
ON CONFLICT (name) DO NOTHING;
