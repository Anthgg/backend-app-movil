-- Complete the Peru Ubigeo district catalog to 1,891 districts.
-- These 17 districts are present in the 25 department / 196 province / 1,891 district catalog
-- and were missing from the previous materialized seed.
WITH source_districts (province_code, code, name) AS (
  VALUES
    ('0306', '030612', 'Ahuayro'),
    ('0504', '050413', 'Putis'),
    ('0505', '050512', 'Union Progreso'),
    ('0505', '050513', 'Rio Magdalena'),
    ('0505', '050514', 'Ninabamba'),
    ('0505', '050515', 'Patibamba'),
    ('0809', '080915', 'Kumpirushiato'),
    ('0809', '080916', 'Cielo Punco'),
    ('0809', '080917', 'Manitea'),
    ('0809', '080918', 'Union Ashaninka'),
    ('0907', '090724', 'Lambras'),
    ('0907', '090725', 'Cochabamba'),
    ('1301', '130112', 'Alto Trujillo'),
    ('1801', '180107', 'San Antonio'),
    ('2210', '221006', 'Santa Lucia'),
    ('2503', '250306', 'Huipoca'),
    ('2503', '250307', 'Boqueron')
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
    ('0306', '030612', 'Ahuayro'),
    ('0504', '050413', 'Putis'),
    ('0505', '050512', 'Union Progreso'),
    ('0505', '050513', 'Rio Magdalena'),
    ('0505', '050514', 'Ninabamba'),
    ('0505', '050515', 'Patibamba'),
    ('0809', '080915', 'Kumpirushiato'),
    ('0809', '080916', 'Cielo Punco'),
    ('0809', '080917', 'Manitea'),
    ('0809', '080918', 'Union Ashaninka'),
    ('0907', '090724', 'Lambras'),
    ('0907', '090725', 'Cochabamba'),
    ('1301', '130112', 'Alto Trujillo'),
    ('1801', '180107', 'San Antonio'),
    ('2210', '221006', 'Santa Lucia'),
    ('2503', '250306', 'Huipoca'),
    ('2503', '250307', 'Boqueron')
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
