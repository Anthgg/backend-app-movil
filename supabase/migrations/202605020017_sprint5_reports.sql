-- ==========================================
-- 1. TABLA GENERATED REPORTS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.generated_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    generated_by UUID REFERENCES public.users(id),
    report_type VARCHAR(100) NOT NULL,
    format VARCHAR(20) NOT NULL, -- excel, pdf
    filters JSONB,
    file_url TEXT,
    file_path TEXT,
    status VARCHAR(30) DEFAULT 'pending', -- pending, generated, failed
    total_rows INTEGER DEFAULT 0,
    error_message TEXT,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. PERMISOS SPRINT 5
-- ==========================================
INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'reports.attendance.read', 'Leer reporte asistencia'),
(uuid_generate_v4(), 'reports.attendance.export', 'Exportar reporte asistencia'),
(uuid_generate_v4(), 'reports.absences.read', 'Leer reporte faltas'),
(uuid_generate_v4(), 'reports.absences.export', 'Exportar reporte faltas'),
(uuid_generate_v4(), 'reports.lates.read', 'Leer reporte tardanzas'),
(uuid_generate_v4(), 'reports.lates.export', 'Exportar reporte tardanzas'),
(uuid_generate_v4(), 'reports.requests.read', 'Leer reporte solicitudes'),
(uuid_generate_v4(), 'reports.requests.export', 'Exportar reporte solicitudes'),
(uuid_generate_v4(), 'reports.vacations.read', 'Leer reporte vacaciones'),
(uuid_generate_v4(), 'reports.vacations.export', 'Exportar reporte vacaciones'),
(uuid_generate_v4(), 'reports.medical_leaves.read', 'Leer reporte descansos medicos'),
(uuid_generate_v4(), 'reports.medical_leaves.export', 'Exportar reporte descansos medicos'),
(uuid_generate_v4(), 'reports.workers.read', 'Leer reporte trabajadores'),
(uuid_generate_v4(), 'reports.workers.export', 'Exportar reporte trabajadores'),
(uuid_generate_v4(), 'reports.monthly_summary.read', 'Leer reporte resumen mensual'),
(uuid_generate_v4(), 'reports.monthly_summary.export', 'Exportar reporte resumen mensual')
ON CONFLICT (name) DO NOTHING;
