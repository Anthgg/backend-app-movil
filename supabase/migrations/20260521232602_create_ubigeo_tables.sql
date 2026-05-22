-- Migration: Create Ubigeo Tables (departments, provinces, districts)

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20),
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS public.provinces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20),
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS public.districts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  province_id UUID REFERENCES public.provinces(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20),
  status BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ubigeo_departments_name ON public.departments(LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ubigeo_provinces_name ON public.provinces(department_id, LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ubigeo_districts_name ON public.districts(province_id, LOWER(name)) WHERE deleted_at IS NULL;

-- SEED DATA (Lima y Callao como muestra base)
DO $$
DECLARE
  lima_dep_id UUID := '11111111-1111-1111-1111-111111111111';
  callao_dep_id UUID := '22222222-2222-2222-2222-222222222222';
  
  lima_prov_id UUID := '11111111-1111-1111-2222-111111111111';
  callao_prov_id UUID := '22222222-2222-2222-2222-222222222222';
BEGIN
  -- Insert Departments
  INSERT INTO public.departments (id, name, code)
  VALUES 
    (lima_dep_id, 'Lima', '15'),
    (callao_dep_id, 'Callao', '07')
  ON CONFLICT DO NOTHING;

  -- Insert Provinces
  INSERT INTO public.provinces (id, department_id, name, code)
  VALUES 
    (lima_prov_id, lima_dep_id, 'Lima', '1501'),
    (callao_prov_id, callao_dep_id, 'Callao', '0701')
  ON CONFLICT DO NOTHING;

  -- Insert Districts (Lima)
  INSERT INTO public.districts (id, province_id, name, code)
  VALUES 
    (uuid_generate_v4(), lima_prov_id, 'Lima', '150101'),
    (uuid_generate_v4(), lima_prov_id, 'Ancón', '150102'),
    (uuid_generate_v4(), lima_prov_id, 'Ate', '150103'),
    (uuid_generate_v4(), lima_prov_id, 'Barranco', '150104'),
    (uuid_generate_v4(), lima_prov_id, 'Breña', '150105'),
    (uuid_generate_v4(), lima_prov_id, 'Comas', '150110'),
    (uuid_generate_v4(), lima_prov_id, 'Los Olivos', '150117'),
    (uuid_generate_v4(), lima_prov_id, 'Miraflores', '150122'),
    (uuid_generate_v4(), lima_prov_id, 'San Isidro', '150131'),
    (uuid_generate_v4(), lima_prov_id, 'San Juan de Lurigancho', '150132'),
    (uuid_generate_v4(), lima_prov_id, 'San Juan de Miraflores', '150133'),
    (uuid_generate_v4(), lima_prov_id, 'San Martín de Porres', '150135'),
    (uuid_generate_v4(), lima_prov_id, 'Surco', '150140'),
    (uuid_generate_v4(), lima_prov_id, 'Villa El Salvador', '150142')
  ON CONFLICT DO NOTHING;

  -- Insert Districts (Callao)
  INSERT INTO public.districts (id, province_id, name, code)
  VALUES 
    (uuid_generate_v4(), callao_prov_id, 'Callao', '070101'),
    (uuid_generate_v4(), callao_prov_id, 'Bellavista', '070102'),
    (uuid_generate_v4(), callao_prov_id, 'Carmen de la Legua Reynoso', '070103'),
    (uuid_generate_v4(), callao_prov_id, 'La Perla', '070104'),
    (uuid_generate_v4(), callao_prov_id, 'La Punta', '070105'),
    (uuid_generate_v4(), callao_prov_id, 'Ventanilla', '070106'),
    (uuid_generate_v4(), callao_prov_id, 'Mi Perú', '070107')
  ON CONFLICT DO NOTHING;

END $$;
