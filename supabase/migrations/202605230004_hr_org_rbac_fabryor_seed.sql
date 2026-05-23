-- HR organization catalog and RBAC alignment for multi-company flows.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.areas
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

UPDATE public.areas
SET is_active = COALESCE(status, TRUE)
WHERE is_active IS NULL;

ALTER TABLE public.job_positions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

UPDATE public.job_positions
SET is_active = COALESCE(status, TRUE)
WHERE is_active IS NULL;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_system_role BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

UPDATE public.roles
SET code = UPPER(REGEXP_REPLACE(name, '[^A-Za-z0-9]+', '_', 'g'))
WHERE code IS NULL OR BTRIM(code) = '';

UPDATE public.roles
SET is_active = TRUE
WHERE is_active IS NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.roles'::regclass
      AND contype = 'u'
      AND conname ILIKE '%name%'
  )
  LOOP
    EXECUTE 'ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_unique_code_company
  ON public.roles(COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(code))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_unique_name_company
  ON public.roles(COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_areas_unique_name_company_active
  ON public.areas(company_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_positions_unique_name_area_active
  ON public.job_positions(company_id, area_id, LOWER(name))
  WHERE deleted_at IS NULL;

INSERT INTO public.permissions (id, name, description) VALUES
  (uuid_generate_v4(), 'areas.read', 'Listar y consultar areas'),
  (uuid_generate_v4(), 'areas.create', 'Crear areas'),
  (uuid_generate_v4(), 'areas.update', 'Actualizar areas'),
  (uuid_generate_v4(), 'areas.delete', 'Eliminar areas'),
  (uuid_generate_v4(), 'job_positions.read', 'Listar y consultar puestos de trabajo'),
  (uuid_generate_v4(), 'job_positions.create', 'Crear puestos de trabajo'),
  (uuid_generate_v4(), 'job_positions.update', 'Actualizar puestos de trabajo'),
  (uuid_generate_v4(), 'job_positions.delete', 'Eliminar puestos de trabajo'),
  (uuid_generate_v4(), 'roles.read', 'Listar y consultar roles'),
  (uuid_generate_v4(), 'roles.create', 'Crear roles'),
  (uuid_generate_v4(), 'roles.update', 'Actualizar roles'),
  (uuid_generate_v4(), 'roles.delete', 'Eliminar roles')
ON CONFLICT (name) DO NOTHING;

WITH source_roles (code, name, description, is_system_role) AS (
  VALUES
    ('ADMIN', 'Administrador', 'Administrador del sistema', TRUE),
    ('RRHH', 'Recursos Humanos', 'Gestion de personal y contratacion', TRUE),
    ('SUPERVISOR', 'Supervisor', 'Supervision operativa y de obra', TRUE),
    ('TRABAJADOR', 'Trabajador', 'Trabajador regular', TRUE),
    ('LOGISTICA', 'Logistica', 'Gestion logistica, compras y almacen', TRUE),
    ('CONTABILIDAD', 'Contabilidad', 'Gestion contable y financiera', TRUE),
    ('GERENCIA', 'Gerencia', 'Direccion y aprobaciones gerenciales', TRUE),
    ('SEGURIDAD', 'Seguridad y SST', 'Seguridad y salud en el trabajo', TRUE),
    ('SISTEMAS', 'Sistemas', 'Soporte tecnico y administracion de sistemas', TRUE)
)
INSERT INTO public.roles (company_id, code, name, description, is_system_role, is_active)
SELECT NULL, source.code, source.name, source.description, source.is_system_role, TRUE
FROM source_roles source
WHERE NOT EXISTS (
  SELECT 1
  FROM public.roles role
  WHERE role.company_id IS NULL
    AND role.deleted_at IS NULL
    AND LOWER(role.code) = LOWER(source.code)
)
ON CONFLICT DO NOTHING;

WITH admin_permissions AS (
  SELECT p.id
  FROM public.permissions p
  WHERE p.name IN (
    'areas.read', 'areas.create', 'areas.update', 'areas.delete',
    'job_positions.read', 'job_positions.create', 'job_positions.update', 'job_positions.delete',
    'roles.read', 'roles.create', 'roles.update', 'roles.delete',
    'users.read', 'users.create', 'users.update', 'users.delete'
  )
),
admin_roles AS (
  SELECT r.id
  FROM public.roles r
  WHERE r.deleted_at IS NULL
    AND UPPER(COALESCE(r.code, r.name)) = 'ADMIN'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT admin_roles.id, admin_permissions.id
FROM admin_roles
CROSS JOIN admin_permissions
ON CONFLICT DO NOTHING;

WITH read_permissions AS (
  SELECT p.id
  FROM public.permissions p
  WHERE p.name IN ('areas.read', 'job_positions.read', 'roles.read', 'users.create', 'users.read')
),
rrhh_roles AS (
  SELECT r.id
  FROM public.roles r
  WHERE r.deleted_at IS NULL
    AND UPPER(COALESCE(r.code, r.name)) = 'RRHH'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rrhh_roles.id, read_permissions.id
FROM rrhh_roles
CROSS JOIN read_permissions
ON CONFLICT DO NOTHING;

WITH read_permissions AS (
  SELECT p.id
  FROM public.permissions p
  WHERE p.name IN ('areas.read', 'job_positions.read')
),
supervisor_roles AS (
  SELECT r.id
  FROM public.roles r
  WHERE r.deleted_at IS NULL
    AND UPPER(COALESCE(r.code, r.name)) = 'SUPERVISOR'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT supervisor_roles.id, read_permissions.id
FROM supervisor_roles
CROSS JOIN read_permissions
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  fabryor_company_id UUID;
BEGIN
  SELECT id
  INTO fabryor_company_id
  FROM public.companies
  WHERE deleted_at IS NULL
    AND (
      name ILIKE '%FABRYOR%'
      OR ruc IN ('20601810521', '20999999999')
    )
  ORDER BY CASE WHEN name ILIKE '%SERVICIOS GENERALES%' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1;

  IF fabryor_company_id IS NULL THEN
    RAISE NOTICE 'FABRYOR company not found. Skipping FABRYOR areas and job positions seed.';
    RETURN;
  END IF;

  WITH source_areas (code, name, description) AS (
    VALUES
      ('ADM', 'Administracion', 'Gestion administrativa de la empresa'),
      ('RRH', 'Recursos Humanos', 'Gestion de personal, contratos y clima laboral'),
      ('OPE', 'Operaciones', 'Gestion operativa y coordinacion de campo'),
      ('OBR', 'Obra / Construccion', 'Ejecucion de obras y trabajos de construccion'),
      ('LOG', 'Logistica', 'Compras, abastecimiento y coordinacion logistica'),
      ('ALM', 'Almacen', 'Control de inventario y almacen'),
      ('CON', 'Contabilidad', 'Gestion contable y financiera'),
      ('SST', 'Seguridad y Salud en el Trabajo', 'Prevencion de riesgos y seguridad ocupacional'),
      ('GER', 'Gerencia', 'Direccion y representacion de la empresa'),
      ('SIS', 'Sistemas', 'Soporte tecnologico y administracion de sistemas')
  )
  INSERT INTO public.areas (company_id, code, name, description, status, is_active)
  SELECT fabryor_company_id, source.code, source.name, source.description, TRUE, TRUE
  FROM source_areas source
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.areas area
    WHERE area.company_id = fabryor_company_id
      AND area.deleted_at IS NULL
      AND LOWER(area.name) = LOWER(source.name)
  )
  ON CONFLICT DO NOTHING;

  WITH source_positions (area_name, code, name, role_code, description, level) AS (
    VALUES
      ('Administracion', 'ADM-001', 'Administrador General', 'ADMIN', 'Responsable de la administracion general', 1),
      ('Administracion', 'ADM-002', 'Asistente Administrativo', 'GERENCIA', 'Soporte administrativo', 3),
      ('Administracion', 'ADM-003', 'Coordinador Administrativo', 'GERENCIA', 'Coordinacion administrativa', 2),
      ('Recursos Humanos', 'RRH-001', 'Jefe de Recursos Humanos', 'RRHH', 'Responsable del area de recursos humanos', 1),
      ('Recursos Humanos', 'RRH-002', 'Asistente de Recursos Humanos', 'RRHH', 'Soporte al proceso de personal', 3),
      ('Recursos Humanos', 'RRH-003', 'Analista de Personal', 'RRHH', 'Analisis y gestion de personal', 2),
      ('Recursos Humanos', 'RRH-004', 'Encargado de Contratos', 'RRHH', 'Gestion documental de contratos', 2),
      ('Operaciones', 'OPE-001', 'Jefe de Operaciones', 'SUPERVISOR', 'Direccion operativa', 1),
      ('Operaciones', 'OPE-002', 'Supervisor de Obra', 'SUPERVISOR', 'Supervision de obra', 2),
      ('Operaciones', 'OPE-003', 'Coordinador de Campo', 'SUPERVISOR', 'Coordinacion de actividades en campo', 2),
      ('Obra / Construccion', 'OBR-001', 'Maestro de Obra', 'TRABAJADOR', 'Direccion tecnica en obra', 2),
      ('Obra / Construccion', 'OBR-002', 'Operario', 'TRABAJADOR', 'Ejecucion de labores operativas', 4),
      ('Obra / Construccion', 'OBR-003', 'Ayudante de Obra', 'TRABAJADOR', 'Apoyo en actividades de obra', 5),
      ('Obra / Construccion', 'OBR-004', 'Tecnico de Campo', 'TRABAJADOR', 'Soporte tecnico en campo', 4),
      ('Obra / Construccion', 'OBR-005', 'Peon', 'TRABAJADOR', 'Apoyo general en obra', 5),
      ('Obra / Construccion', 'OBR-006', 'Albanil', 'TRABAJADOR', 'Trabajos de albanileria', 4),
      ('Obra / Construccion', 'OBR-007', 'Electricista', 'TRABAJADOR', 'Trabajos electricos', 4),
      ('Obra / Construccion', 'OBR-008', 'Soldador', 'TRABAJADOR', 'Trabajos de soldadura', 4),
      ('Obra / Construccion', 'OBR-009', 'Pintor', 'TRABAJADOR', 'Trabajos de pintura', 4),
      ('Obra / Construccion', 'OBR-010', 'Gasfitero', 'TRABAJADOR', 'Trabajos de gasfiteria', 4),
      ('Logistica', 'LOG-001', 'Jefe de Logistica', 'LOGISTICA', 'Direccion logistica', 1),
      ('Logistica', 'LOG-002', 'Asistente Logistico', 'LOGISTICA', 'Soporte logistico', 3),
      ('Logistica', 'LOG-003', 'Auxiliar Logistico', 'LOGISTICA', 'Apoyo logistico', 4),
      ('Logistica', 'LOG-004', 'Encargado de Compras', 'LOGISTICA', 'Gestion de compras', 2),
      ('Almacen', 'ALM-001', 'Jefe de Almacen', 'LOGISTICA', 'Responsable de almacen', 1),
      ('Almacen', 'ALM-002', 'Auxiliar de Almacen', 'TRABAJADOR', 'Apoyo de almacen', 4),
      ('Almacen', 'ALM-003', 'Operario de Almacen', 'TRABAJADOR', 'Operacion de almacen', 4),
      ('Almacen', 'ALM-004', 'Controlador de Inventario', 'LOGISTICA', 'Control de inventarios', 3),
      ('Contabilidad', 'CON-001', 'Contador', 'CONTABILIDAD', 'Responsable contable', 1),
      ('Contabilidad', 'CON-002', 'Asistente Contable', 'CONTABILIDAD', 'Soporte contable', 3),
      ('Contabilidad', 'CON-003', 'Auxiliar Contable', 'CONTABILIDAD', 'Apoyo contable', 4),
      ('Seguridad y Salud en el Trabajo', 'SST-001', 'Supervisor SST', 'SEGURIDAD', 'Supervision de seguridad y salud', 2),
      ('Seguridad y Salud en el Trabajo', 'SST-002', 'Prevencionista de Riesgos', 'SEGURIDAD', 'Prevencion de riesgos', 3),
      ('Seguridad y Salud en el Trabajo', 'SST-003', 'Inspector de Seguridad', 'SEGURIDAD', 'Inspeccion de seguridad', 3),
      ('Gerencia', 'GER-001', 'Gerente General', 'GERENCIA', 'Direccion general', 1),
      ('Gerencia', 'GER-002', 'Subgerente', 'GERENCIA', 'Soporte a gerencia general', 1),
      ('Gerencia', 'GER-003', 'Representante Legal', 'GERENCIA', 'Representacion legal', 1),
      ('Sistemas', 'SIS-001', 'Administrador de Sistemas', 'SISTEMAS', 'Administracion tecnologica', 1),
      ('Sistemas', 'SIS-002', 'Soporte Tecnico', 'SISTEMAS', 'Soporte a usuarios y equipos', 3),
      ('Sistemas', 'SIS-003', 'Analista de Sistemas', 'SISTEMAS', 'Analisis y mejora de sistemas', 2)
  )
  INSERT INTO public.job_positions (company_id, area_id, code, name, description, level, default_role_id, status, is_active)
  SELECT fabryor_company_id,
         area.id,
         source.code,
         source.name,
         source.description,
         source.level,
         role.id,
         TRUE,
         TRUE
  FROM source_positions source
  JOIN public.areas area
    ON area.company_id = fabryor_company_id
   AND area.deleted_at IS NULL
   AND LOWER(area.name) = LOWER(source.area_name)
  LEFT JOIN public.roles role
    ON role.deleted_at IS NULL
   AND role.is_active = TRUE
   AND UPPER(role.code) = source.role_code
   AND (role.company_id = fabryor_company_id OR role.company_id IS NULL)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.job_positions position
    WHERE position.company_id = fabryor_company_id
      AND position.area_id = area.id
      AND position.deleted_at IS NULL
      AND LOWER(position.name) = LOWER(source.name)
  )
  ON CONFLICT DO NOTHING;
END $$;
