INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'dashboard.read', 'Leer dashboard'),
(uuid_generate_v4(), 'dashboard.admin', 'Admin dashboard global'),
(uuid_generate_v4(), 'shifts.create', 'Crear turnos'),
(uuid_generate_v4(), 'shifts.read', 'Leer turnos'),
(uuid_generate_v4(), 'shifts.update', 'Actualizar turnos'),
(uuid_generate_v4(), 'shifts.delete', 'Eliminar turnos'),
(uuid_generate_v4(), 'worker_shifts.assign', 'Asignar turnos a trabajadores'),
(uuid_generate_v4(), 'worker_shifts.read', 'Leer turnos de trabajadores'),
(uuid_generate_v4(), 'calendar.create', 'Crear calendario y feriados'),
(uuid_generate_v4(), 'calendar.read', 'Leer calendario'),
(uuid_generate_v4(), 'calendar.update', 'Actualizar calendario'),
(uuid_generate_v4(), 'calendar.delete', 'Eliminar calendario'),
(uuid_generate_v4(), 'overtime.create', 'Crear horas extra'),
(uuid_generate_v4(), 'overtime.read', 'Leer horas extra'),
(uuid_generate_v4(), 'overtime.approve', 'Aprobar horas extra'),
(uuid_generate_v4(), 'overtime.reject', 'Rechazar horas extra')
ON CONFLICT (name) DO NOTHING;
