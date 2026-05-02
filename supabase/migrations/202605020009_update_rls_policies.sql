-- Habilitar RLS en las tablas que faltaban
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- 1. Políticas para tablas informativas (Lectura para todos los usuarios autenticados)
-- Nota: La edición (INSERT/UPDATE/DELETE) quedará bloqueada para clientes web,
-- pero tu backend en Node.js (que usa rol postgres bypassRLS o service_role) sí podrá editarlas.
CREATE POLICY "Lectura de proyectos para autenticados" ON public.projects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Lectura de departamentos para autenticados" ON public.departments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Lectura de puestos laborales para autenticados" ON public.job_positions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Lectura de tipos de documento para autenticados" ON public.document_types FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Lectura de permisos para autenticados" ON public.permissions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Lectura de periodos de planilla para autenticados" ON public.payroll_periods FOR SELECT USING (auth.role() = 'authenticated');

-- 2. Políticas de privacidad estricta (El trabajador solo ve lo suyo)
-- NÓMINA / SUELDOS ESTIMADOS (payroll_records)
CREATE POLICY "Trabajador ve su propia planilla" ON public.payroll_records FOR SELECT USING (
    worker_id IN (SELECT id FROM public.workers WHERE user_id = auth.uid())
);

-- ASIGNACIONES DE PROYECTOS (project_assignments)
CREATE POLICY "Trabajador ve sus propias asignaciones" ON public.project_assignments FOR SELECT USING (
    worker_id IN (SELECT id FROM public.workers WHERE user_id = auth.uid())
);

-- FOTOS DE ASISTENCIA (attendance_photos)
-- Permite SELECT e INSERT si la asistencia le pertenece al usuario logueado
CREATE POLICY "Trabajador gestiona sus fotos" ON public.attendance_photos FOR ALL USING (
    attendance_record_id IN (
        SELECT ar.id FROM public.attendance_records ar
        JOIN public.workers w ON ar.worker_id = w.id
        WHERE w.user_id = auth.uid()
    )
);

-- CORRECCIONES DE ASISTENCIA (attendance_corrections)
CREATE POLICY "Trabajador ve sus propias correcciones" ON public.attendance_corrections FOR SELECT USING (
    attendance_record_id IN (
        SELECT ar.id FROM public.attendance_records ar
        JOIN public.workers w ON ar.worker_id = w.id
        WHERE w.user_id = auth.uid()
    )
);

-- LOS REGISTROS DE AUDITORÍA (audit_logs) QUEDAN SIN POLÍTICAS 
-- Esto significa que nadie desde la app cliente/móvil podrá leerlos ni escribirlos,
-- logrando la máxima seguridad. Solo el backend con credenciales maestras puede interactuar.
