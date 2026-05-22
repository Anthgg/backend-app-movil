-- Complete the Peru department catalog for Ubigeo.
WITH ubigeo_departments (name, code) AS (
  VALUES
    ('Amazonas', '01'),
    ('Ancash', '02'),
    ('Apurimac', '03'),
    ('Arequipa', '04'),
    ('Ayacucho', '05'),
    ('Cajamarca', '06'),
    ('Callao', '07'),
    ('Cusco', '08'),
    ('Huancavelica', '09'),
    ('Huanuco', '10'),
    ('Ica', '11'),
    ('Junin', '12'),
    ('La Libertad', '13'),
    ('Lambayeque', '14'),
    ('Lima', '15'),
    ('Loreto', '16'),
    ('Madre de Dios', '17'),
    ('Moquegua', '18'),
    ('Pasco', '19'),
    ('Piura', '20'),
    ('Puno', '21'),
    ('San Martin', '22'),
    ('Tacna', '23'),
    ('Tumbes', '24'),
    ('Ucayali', '25')
)
INSERT INTO public.departments (name, code, status)
SELECT seed.name, seed.code, TRUE
FROM ubigeo_departments seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.departments department
  WHERE department.deleted_at IS NULL
    AND LOWER(department.name) = LOWER(seed.name)
)
ON CONFLICT DO NOTHING;

WITH ubigeo_departments (name, code) AS (
  VALUES
    ('Amazonas', '01'),
    ('Ancash', '02'),
    ('Apurimac', '03'),
    ('Arequipa', '04'),
    ('Ayacucho', '05'),
    ('Cajamarca', '06'),
    ('Callao', '07'),
    ('Cusco', '08'),
    ('Huancavelica', '09'),
    ('Huanuco', '10'),
    ('Ica', '11'),
    ('Junin', '12'),
    ('La Libertad', '13'),
    ('Lambayeque', '14'),
    ('Lima', '15'),
    ('Loreto', '16'),
    ('Madre de Dios', '17'),
    ('Moquegua', '18'),
    ('Pasco', '19'),
    ('Piura', '20'),
    ('Puno', '21'),
    ('San Martin', '22'),
    ('Tacna', '23'),
    ('Tumbes', '24'),
    ('Ucayali', '25')
)
UPDATE public.departments department
SET code = seed.code,
    status = TRUE,
    updated_at = NOW()
FROM ubigeo_departments seed
WHERE department.deleted_at IS NULL
  AND LOWER(department.name) = LOWER(seed.name);
