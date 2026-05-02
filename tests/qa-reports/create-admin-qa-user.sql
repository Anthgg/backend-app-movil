-- ============================================================
-- SCRIPT QA: Crear usuario admin.qa@demo.com con rol ADMIN
-- Idempotente y alineado con la estructura real de Supabase
-- Ejecutar en Supabase SQL Editor o via DATABASE_URL seguro
-- ============================================================

DO $$
DECLARE
  v_company_id UUID;
  v_role_id UUID;
  v_user_id UUID;
  v_hash TEXT := '$2a$10$elalo2F/26aS7zWpzKyv0ecjYBqdBXUXqe1xHJFFAj3I52Pk1O90.';
BEGIN
  SELECT u.company_id
    INTO v_company_id
  FROM public.users u
  WHERE u.email = 'rrhh.qa@demo.com'
    AND u.company_id IS NOT NULL
  LIMIT 1;

  IF v_company_id IS NULL THEN
    SELECT c.id
      INTO v_company_id
    FROM public.companies c
    WHERE c.name = 'Empresa Demo S.A.C.'
      AND c.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    SELECT c.id
      INTO v_company_id
    FROM public.companies c
    WHERE c.is_active = true
      AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC
    LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro una empresa valida para el usuario ADMIN QA';
  END IF;

  INSERT INTO public.roles (name, description, company_id)
  VALUES ('ADMIN', 'Administrador del sistema', v_company_id)
  ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description,
        company_id = EXCLUDED.company_id,
        updated_at = NOW()
  RETURNING id INTO v_role_id;

  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id
    FROM public.roles
    WHERE name = 'ADMIN'
    LIMIT 1;
  END IF;

  INSERT INTO public.permissions (name, description) VALUES
    ('users.read', 'Leer usuarios'),
    ('users.create', 'Crear usuarios'),
    ('users.update', 'Actualizar usuarios'),
    ('users.delete', 'Eliminar usuarios'),
    ('users.disable', 'Desactivar usuarios'),
    ('users.enable', 'Activar usuarios'),
    ('users.block', 'Bloquear usuarios'),
    ('users.suspend', 'Suspender usuarios'),
    ('workers.read', 'Leer trabajadores'),
    ('workers.create', 'Crear trabajadores'),
    ('workers.update', 'Actualizar trabajadores'),
    ('workers.delete', 'Eliminar trabajadores'),
    ('workers.disable', 'Desactivar trabajadores'),
    ('workers.lookup_dni', 'Consultar DNI externo'),
    ('devices.read', 'Leer dispositivos'),
    ('devices.create', 'Crear dispositivos'),
    ('devices.update', 'Actualizar dispositivos'),
    ('devices.manage', 'Administrar dispositivos'),
    ('attendance.read', 'Leer asistencia'),
    ('attendance.create', 'Crear asistencia'),
    ('attendance.update', 'Actualizar asistencia'),
    ('attendance.correct', 'Corregir asistencia'),
    ('dashboard.read', 'Leer dashboard'),
    ('reports.attendance.read', 'Leer reporte asistencia'),
    ('payroll.read', 'Leer planilla'),
    ('payroll.periods.read', 'Leer periodos de planilla'),
    ('payroll.periods.create', 'Crear periodo de planilla'),
    ('payroll.periods.generate', 'Generar planilla'),
    ('payroll.periods.recalculate', 'Recalcular planilla'),
    ('payroll.periods.approve', 'Aprobar planilla'),
    ('payroll.periods.close', 'Cerrar planilla'),
    ('payroll.export', 'Exportar planilla'),
    ('reports.absences.read', 'Leer reporte faltas'),
    ('reports.lates.read', 'Leer reporte tardanzas'),
    ('reports.requests.read', 'Leer reporte solicitudes'),
    ('reports.vacations.read', 'Leer reporte vacaciones'),
    ('reports.medical_leaves.read', 'Leer reporte descansos medicos'),
    ('reports.workers.read', 'Leer reporte trabajadores'),
    ('reports.monthly_summary.read', 'Leer reporte resumen mensual'),
    ('shifts.read', 'Leer turnos'),
    ('shifts.manage', 'Administrar turnos')
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = 'admin.qa@demo.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    INSERT INTO public.users (
      email,
      password_hash,
      first_name,
      last_name,
      company_id,
      is_active,
      status
    )
    VALUES (
      'admin.qa@demo.com',
      v_hash,
      'Usuario Admin',
      'QA',
      v_company_id,
      true,
      'active'
    )
    RETURNING id INTO v_user_id;
  ELSE
    UPDATE public.users
    SET password_hash = v_hash,
        first_name = 'Usuario Admin',
        last_name = 'QA',
        company_id = v_company_id,
        is_active = true,
        status = 'active',
        deleted_at = NULL
    WHERE id = v_user_id;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = v_user_id;

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_role_id)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.role_permissions
  WHERE role_id = v_role_id
    AND permission_id NOT IN (
      SELECT id FROM public.permissions
    );

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  ON CONFLICT DO NOTHING;
END $$;

SELECT
  u.email,
  u.is_active,
  u.status,
  u.company_id,
  r.name AS role,
  COALESCE(array_agg(DISTINCT p.name ORDER BY p.name) FILTER (WHERE p.name IS NOT NULL), ARRAY[]::text[]) AS permissions
FROM public.users u
JOIN public.user_roles ur ON ur.user_id = u.id
JOIN public.roles r ON r.id = ur.role_id
LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
LEFT JOIN public.permissions p ON p.id = rp.permission_id
WHERE u.email = 'admin.qa@demo.com'
GROUP BY u.email, u.is_active, u.status, u.company_id, r.name;