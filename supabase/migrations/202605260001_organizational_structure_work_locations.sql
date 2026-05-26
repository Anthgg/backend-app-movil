-- Organizational structure and work locations
-- Separates Peru geography catalogs from internal company departments.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF to_regclass('public.geographic_departments') IS NULL
     AND to_regclass('public.departments') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'company_id'
     ) THEN
    ALTER TABLE public.departments RENAME TO geographic_departments;
  END IF;

  IF to_regclass('public.geographic_provinces') IS NULL
     AND to_regclass('public.provinces') IS NOT NULL THEN
    ALTER TABLE public.provinces RENAME TO geographic_provinces;
  END IF;

  IF to_regclass('public.geographic_districts') IS NULL
     AND to_regclass('public.districts') IS NOT NULL THEN
    ALTER TABLE public.districts RENAME TO geographic_districts;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.geographic_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20),
  ubigeo_code VARCHAR(20),
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS public.geographic_provinces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID REFERENCES public.geographic_departments(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20),
  ubigeo_code VARCHAR(20),
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS public.geographic_districts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  province_id UUID REFERENCES public.geographic_provinces(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20),
  ubigeo_code VARCHAR(20),
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.geographic_departments
  ADD COLUMN IF NOT EXISTS code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ubigeo_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS status BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.geographic_provinces
  ADD COLUMN IF NOT EXISTS code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ubigeo_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS status BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.geographic_districts
  ADD COLUMN IF NOT EXISTS code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS ubigeo_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS status BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

UPDATE public.geographic_departments SET ubigeo_code = COALESCE(ubigeo_code, code);
UPDATE public.geographic_provinces SET ubigeo_code = COALESCE(ubigeo_code, code);
UPDATE public.geographic_districts SET ubigeo_code = COALESCE(ubigeo_code, code);

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  deleted_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_company_name_unique
  ON public.departments(company_id, LOWER(name))
  WHERE deleted_at IS NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  IF to_regclass('public.areas') IS NOT NULL THEN
    FOR constraint_name IN (
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.areas'::regclass
        AND contype = 'f'
        AND conkey = ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.areas'::regclass AND attname = 'department_id')
        ]::smallint[]
    )
    LOOP
      EXECUTE 'ALTER TABLE public.areas DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name);
    END LOOP;
  END IF;
END $$;

ALTER TABLE public.areas
  ADD COLUMN IF NOT EXISTS department_id UUID,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

INSERT INTO public.departments (company_id, name, description, is_active, status)
SELECT DISTINCT a.company_id, 'Administracion', 'Departamento interno por defecto', TRUE, TRUE
FROM public.areas a
WHERE a.company_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE public.areas a
SET department_id = d.id
FROM public.departments d
WHERE d.company_id = a.company_id
  AND d.name = 'Administracion'
  AND (
    a.department_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.departments existing WHERE existing.id = a.department_id)
  );

ALTER TABLE public.areas
  ADD CONSTRAINT fk_areas_department_id
  FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE RESTRICT;

ALTER TABLE public.job_positions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS sede_id UUID,
  ADD COLUMN IF NOT EXISTS internal_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES public.areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES public.job_positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_location_id UUID,
  ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS start_date DATE;

CREATE TABLE IF NOT EXISTS public.work_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sede_id UUID,
  name VARCHAR(150) NOT NULL,
  address TEXT NOT NULL,
  geographic_department_id UUID NOT NULL REFERENCES public.geographic_departments(id) ON DELETE RESTRICT,
  geographic_province_id UUID NOT NULL REFERENCES public.geographic_provinces(id) ON DELETE RESTRICT,
  geographic_district_id UUID NOT NULL REFERENCES public.geographic_districts(id) ON DELETE RESTRICT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  allowed_radius_meters INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT TRUE,
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  deleted_by UUID
);

ALTER TABLE public.workers
  ADD CONSTRAINT fk_workers_work_location_id
  FOREIGN KEY (work_location_id) REFERENCES public.work_locations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_locations_company_name_unique
  ON public.work_locations(company_id, LOWER(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_departments_company_active ON public.departments(company_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_areas_company_department_active ON public.areas(company_id, department_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_positions_company_area_active ON public.job_positions(company_id, area_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_locations_company_active ON public.work_locations(company_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workers_labor_assignment ON public.workers(company_id, internal_department_id, area_id, position_id, work_location_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_geographic_departments_name ON public.geographic_departments(LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_geographic_provinces_name ON public.geographic_provinces(department_id, LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_geographic_districts_name ON public.geographic_districts(province_id, LOWER(name)) WHERE deleted_at IS NULL;

INSERT INTO public.permissions (id, name, description)
VALUES
  (uuid_generate_v4(), 'departments.read', 'Listar y consultar departamentos internos'),
  (uuid_generate_v4(), 'departments.create', 'Crear departamentos internos'),
  (uuid_generate_v4(), 'departments.update', 'Actualizar departamentos internos'),
  (uuid_generate_v4(), 'departments.delete', 'Desactivar departamentos internos'),
  (uuid_generate_v4(), 'work_locations.read', 'Listar y consultar lugares de trabajo'),
  (uuid_generate_v4(), 'work_locations.create', 'Crear lugares de trabajo'),
  (uuid_generate_v4(), 'work_locations.update', 'Actualizar lugares de trabajo'),
  (uuid_generate_v4(), 'work_locations.delete', 'Desactivar lugares de trabajo')
ON CONFLICT (name) DO NOTHING;

WITH managed_permissions AS (
  SELECT id
  FROM public.permissions
  WHERE name IN (
    'departments.read', 'departments.create', 'departments.update', 'departments.delete',
    'areas.read', 'areas.create', 'areas.update', 'areas.delete',
    'job_positions.read', 'job_positions.create', 'job_positions.update', 'job_positions.delete',
    'work_locations.read', 'work_locations.create', 'work_locations.update', 'work_locations.delete',
    'workers.read', 'workers.update'
  )
),
managed_roles AS (
  SELECT id
  FROM public.roles
  WHERE UPPER(COALESCE(code, name)) IN ('ADMIN', 'RRHH')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT managed_roles.id, managed_permissions.id
FROM managed_roles
CROSS JOIN managed_permissions
ON CONFLICT DO NOTHING;
