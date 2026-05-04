-- Agregar la columna company_id a request_types si no existe
ALTER TABLE public.request_types
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- Poblar company_id para registros existentes (si los hay)
-- Se asume que existe al menos una empresa, se toma la primera.
DO $$
DECLARE
    default_company_id UUID;
BEGIN
    SELECT id INTO default_company_id FROM public.companies LIMIT 1;
    IF default_company_id IS NOT NULL THEN
        UPDATE public.request_types
        SET company_id = default_company_id
        WHERE company_id IS NULL;
    END IF;
END $$;

-- Crear índice para mejorar rendimiento en queries por empresa
CREATE INDEX IF NOT EXISTS idx_request_types_company_id ON public.request_types(company_id);
