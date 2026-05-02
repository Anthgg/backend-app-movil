-- ROLES
INSERT INTO public.roles (id, name, description) VALUES
(uuid_generate_v4(), 'ADMIN', 'Administrador del Sistema'),
(uuid_generate_v4(), 'RRHH', 'Recursos Humanos'),
(uuid_generate_v4(), 'SUPERVISOR', 'Supervisor de Obra o Proyecto'),
(uuid_generate_v4(), 'TRABAJADOR', 'Trabajador Regular')
ON CONFLICT (name) DO NOTHING;

-- PERMISSIONS
INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'MANAGE_USERS', 'Crear, editar y eliminar usuarios'),
(uuid_generate_v4(), 'MANAGE_WORKERS', 'Crear y editar trabajadores'),
(uuid_generate_v4(), 'VIEW_REPORTS', 'Ver reportes globales'),
(uuid_generate_v4(), 'MANAGE_ATTENDANCE', 'Corregir asistencia'),
(uuid_generate_v4(), 'REGISTER_ATTENDANCE', 'Registrar entrada y salida')
ON CONFLICT (name) DO NOTHING;

-- ADMIN USER (Password: Admin123!)
-- Hash de bcrypt para "Admin123!": $2a$10$Xy... (Generado para este ejemplo)
INSERT INTO public.users (id, email, password_hash, first_name, last_name) VALUES
('11111111-1111-1111-1111-111111111111', 'admin@empresa.com', '$2a$10$q2/TjZ6LzjD/2l7m8A2A/eP6oK9BtzvD1A.LXZ.YgW7a/nK3Y6e6a', 'Super', 'Admin')
ON CONFLICT (email) DO NOTHING;

-- ASSIGN ADMIN ROLE TO ADMIN USER
INSERT INTO public.user_roles (user_id, role_id)
SELECT '11111111-1111-1111-1111-111111111111', id FROM public.roles WHERE name = 'ADMIN'
ON CONFLICT DO NOTHING;

-- REQUEST TYPES
INSERT INTO public.request_types (id, name, description) VALUES
(uuid_generate_v4(), 'PERMISO_PERSONAL', 'Permiso por asuntos personales'),
(uuid_generate_v4(), 'VACACIONES', 'Solicitud de vacaciones'),
(uuid_generate_v4(), 'DESCANSO_MEDICO', 'Descanso médico con certificado')
ON CONFLICT (name) DO NOTHING;

-- DOCUMENT TYPES
INSERT INTO public.document_types (id, name, description, is_required) VALUES
(uuid_generate_v4(), 'DNI', 'Documento de Identidad', true),
(uuid_generate_v4(), 'CERTIFICADO_MEDICO', 'Certificado por descanso médico', false)
ON CONFLICT (name) DO NOTHING;

-- JOB POSITIONS
INSERT INTO public.job_positions (id, title, base_salary) VALUES
(uuid_generate_v4(), 'Albañil', 1500.00),
(uuid_generate_v4(), 'Operario', 1200.00),
(uuid_generate_v4(), 'Supervisor de Obra', 3000.00)
ON CONFLICT DO NOTHING;
