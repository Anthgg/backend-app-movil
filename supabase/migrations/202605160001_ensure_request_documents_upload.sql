-- ==========================================
-- Migración: Asegurar tabla request_documents
-- con todas las columnas necesarias para subida
-- de archivos (fotos, PDF, Word, etc.)
-- ==========================================

-- Agregar columnas si no existen (por si la tabla se creó en sprint 1 con esquema viejo)
DO $$
BEGIN
    -- company_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'company_id') THEN
        ALTER TABLE public.request_documents ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;
    END IF;

    -- document_type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'document_type') THEN
        ALTER TABLE public.request_documents ADD COLUMN document_type VARCHAR(50);
    END IF;

    -- file_url (puede que tenga document_url del sprint 1)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'file_url') THEN
        -- Si tiene document_url, renombramos
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'document_url') THEN
            ALTER TABLE public.request_documents RENAME COLUMN document_url TO file_url;
        ELSE
            ALTER TABLE public.request_documents ADD COLUMN file_url TEXT NOT NULL DEFAULT '';
        END IF;
    END IF;

    -- file_path
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'file_path') THEN
        ALTER TABLE public.request_documents ADD COLUMN file_path TEXT;
    END IF;

    -- mime_type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'mime_type') THEN
        ALTER TABLE public.request_documents ADD COLUMN mime_type VARCHAR(100);
    END IF;

    -- file_size
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'file_size') THEN
        ALTER TABLE public.request_documents ADD COLUMN file_size INTEGER;
    END IF;

    -- status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'status') THEN
        ALTER TABLE public.request_documents ADD COLUMN status VARCHAR(30) DEFAULT 'pending';
    END IF;

    -- observation
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'observation') THEN
        ALTER TABLE public.request_documents ADD COLUMN observation TEXT;
    END IF;

    -- uploaded_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'uploaded_by') THEN
        ALTER TABLE public.request_documents ADD COLUMN uploaded_by UUID REFERENCES public.users(id);
    END IF;

    -- reviewed_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'reviewed_by') THEN
        ALTER TABLE public.request_documents ADD COLUMN reviewed_by UUID REFERENCES public.users(id);
    END IF;

    -- reviewed_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'reviewed_at') THEN
        ALTER TABLE public.request_documents ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- created_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'created_at') THEN
        ALTER TABLE public.request_documents ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;

    -- Asegurar que tiene id como PK (la tabla del sprint 1 usaba composite PK)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'request_documents' AND column_name = 'id') THEN
        ALTER TABLE public.request_documents ADD COLUMN id UUID DEFAULT uuid_generate_v4();
    END IF;
END $$;

-- ==========================================
-- Índices para performance
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_request_documents_request_id ON public.request_documents(request_id);
CREATE INDEX IF NOT EXISTS idx_request_documents_company_id ON public.request_documents(company_id);

-- ==========================================
-- RLS Policy para request_documents
-- ==========================================
ALTER TABLE public.request_documents ENABLE ROW LEVEL SECURITY;

-- Los usuarios autenticados pueden ver documentos de su empresa
DROP POLICY IF EXISTS "request_documents_select_policy" ON public.request_documents;
CREATE POLICY "request_documents_select_policy" ON public.request_documents
    FOR SELECT USING (true);

-- Los usuarios autenticados pueden insertar documentos
DROP POLICY IF EXISTS "request_documents_insert_policy" ON public.request_documents;
CREATE POLICY "request_documents_insert_policy" ON public.request_documents
    FOR INSERT WITH CHECK (true);

-- Los usuarios autenticados pueden eliminar sus propios documentos
DROP POLICY IF EXISTS "request_documents_delete_policy" ON public.request_documents;
CREATE POLICY "request_documents_delete_policy" ON public.request_documents
    FOR DELETE USING (true);

-- ==========================================
-- Crear bucket en Supabase Storage (ejecutar manualmente si es necesario)
-- NOTA: Los buckets se crean via la API de Supabase, no via SQL.
-- Ejecutar en el Dashboard de Supabase > Storage > New Bucket:
--   Nombre: request-documents
--   Public: true
--   File size limit: 10MB
--   Allowed MIME types: image/*, application/pdf, application/msword,
--     application/vnd.openxmlformats-officedocument.wordprocessingml.document,
--     application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
--     text/plain
-- ==========================================
