-- Habilitar RLS en las tablas restantes
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_factor_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;

-- 1. Políticas Informativas (Lectura para todos los autenticados)
CREATE POLICY "Lectura de tipos de solicitud" ON public.request_types FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Lectura de roles" ON public.roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Lectura de horarios" ON public.work_schedules FOR SELECT USING (auth.role() = 'authenticated');

-- 2. Políticas Personales (Basadas en user_id directo)
CREATE POLICY "Usuario gestiona sus refresh tokens" ON public.refresh_tokens FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Usuario gestiona sus dispositivos de confianza" ON public.trusted_devices FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Usuario gestiona su 2FA" ON public.two_factor_auth FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Usuario ve su propio rol" ON public.user_roles FOR SELECT USING (user_id = auth.uid());

-- 3. Documentos de Solicitudes (A través de request_id)
CREATE POLICY "Trabajador gestiona documentos de sus solicitudes" ON public.request_documents FOR ALL USING (
    request_id IN (
        SELECT er.id FROM public.employee_requests er
        JOIN public.workers w ON er.worker_id = w.id
        WHERE w.user_id = auth.uid()
    )
);

-- 4. role_permissions queda sin políticas
-- Al activar RLS y no añadir políticas a role_permissions, bloqueamos 100% que los clientes web (Android/iOS)
-- puedan consultar los permisos del sistema. Solo tu backend podrá revisarlos, lo que es la mejor práctica de seguridad.
