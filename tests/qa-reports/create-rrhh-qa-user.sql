-- ============================================================
-- SCRIPT QA: Crear usuario rrhh.qa@demo.com con rol RRHH
-- Adaptado a la estructura real de tablas (migraciones verificadas)
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================
-- Estructura verificada:
--   users: id, email, password_hash, first_name, last_name,
--          is_active, status, deleted_at, last_login_at, created_at, updated_at
--   roles: id, name (UNIQUE), description
--   user_roles: user_id, role_id (PRIMARY KEY compuesto)
-- ============================================================

DO $$
DECLARE
  v_user_id  UUID;
  v_role_id  UUID;
  v_company_id UUID;
  v_hash     TEXT := '$2a$10$SxPhCKm/LISEi66S1No73eot6omXOEcdHdWT9mrTdcRGDu539Ofr2';
BEGIN

  -- 0. Resolver la empresa demo para el usuario QA
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'Empresa Demo S.A.C.'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id
    FROM public.companies
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro ninguna empresa para asignar al usuario QA';
  END IF;

  RAISE NOTICE 'company_id QA: %', v_company_id;

  -- 1. Obtener o crear el rol RRHH
  --    (El seed ya lo inserta; name tiene UNIQUE constraint)
  INSERT INTO public.roles (name, description)
  VALUES ('RRHH', 'Recursos Humanos')
  ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description
  RETURNING id INTO v_role_id;

  -- Si el INSERT devolvió NULL (porque ON CONFLICT no dispara RETURNING en todos los motores),
  -- hacer SELECT de respaldo
  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'RRHH' LIMIT 1;
  END IF;

  RAISE NOTICE 'role_id RRHH: %', v_role_id;

  -- 2. Crear o actualizar el usuario QA
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = 'rrhh.qa@demo.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Crear nuevo usuario
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
      'rrhh.qa@demo.com',
      v_hash,
      'Usuario RRHH',
      'QA',
      v_company_id,
      true,
      'active'
    )
    RETURNING id INTO v_user_id;
    RAISE NOTICE 'Usuario creado con id: %', v_user_id;
  ELSE
    -- Actualizar usuario existente
    UPDATE public.users
    SET
      password_hash = v_hash,
      first_name    = 'Usuario RRHH',
      last_name     = 'QA',
      company_id    = v_company_id,
      is_active     = true,
      status        = 'active',
      deleted_at    = NULL
    WHERE id = v_user_id;
    RAISE NOTICE 'Usuario actualizado con id: %', v_user_id;
  END IF;

  -- 3. Reasignar rol (eliminar anteriores y asignar RRHH)
  DELETE FROM public.user_roles WHERE user_id = v_user_id;

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_role_id)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Rol RRHH asignado correctamente al usuario %', v_user_id;

END $$;

-- ============================================================
-- VERIFICACIÓN: Ejecutar después del bloque anterior
-- ============================================================
SELECT
  u.id,
  u.email,
  u.first_name,
  u.last_name,
  u.is_active,
  u.status,
  u.deleted_at,
  r.name AS role
FROM public.users u
JOIN public.user_roles ur ON ur.user_id = u.id
JOIN public.roles r       ON r.id = ur.role_id
WHERE u.email = 'rrhh.qa@demo.com';
