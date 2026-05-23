-- Fix Loreto province 1608 and insert its districts when the complete catalog
-- migration was already applied with the duplicated Maynas province label.
WITH source_province (department_code, code, name) AS (
  VALUES ('16', '1608', 'Putumayo')
)
UPDATE public.provinces province
SET department_id = department.id,
    name = source.name,
    code = source.code,
    status = TRUE,
    updated_at = NOW()
FROM source_province source
JOIN public.departments department
  ON department.code = source.department_code
 AND department.deleted_at IS NULL
WHERE province.deleted_at IS NULL
  AND province.code = source.code;

WITH source_province (department_code, code, name) AS (
  VALUES ('16', '1608', 'Putumayo')
)
INSERT INTO public.provinces (department_id, name, code, status)
SELECT department.id, source.name, source.code, TRUE
FROM source_province source
JOIN public.departments department
  ON department.code = source.department_code
 AND department.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.provinces province
  WHERE province.deleted_at IS NULL
    AND province.code = source.code
)
ON CONFLICT DO NOTHING;

WITH source_districts (province_code, code, name) AS (
  VALUES
    ('1608', '160801', 'Putumayo'),
    ('1608', '160802', 'Rosa Panduro'),
    ('1608', '160803', 'Teniente Manuel Clavero'),
    ('1608', '160804', 'Yaguas')
)
UPDATE public.districts district
SET province_id = province.id,
    name = source.name,
    code = source.code,
    status = TRUE,
    updated_at = NOW()
FROM source_districts source
JOIN public.provinces province
  ON province.code = source.province_code
 AND province.deleted_at IS NULL
WHERE district.deleted_at IS NULL
  AND district.code = source.code;

WITH source_districts (province_code, code, name) AS (
  VALUES
    ('1608', '160801', 'Putumayo'),
    ('1608', '160802', 'Rosa Panduro'),
    ('1608', '160803', 'Teniente Manuel Clavero'),
    ('1608', '160804', 'Yaguas')
)
INSERT INTO public.districts (province_id, name, code, status)
SELECT province.id, source.name, source.code, TRUE
FROM source_districts source
JOIN public.provinces province
  ON province.code = source.province_code
 AND province.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.districts district
  WHERE district.deleted_at IS NULL
    AND district.code = source.code
)
ON CONFLICT DO NOTHING;
