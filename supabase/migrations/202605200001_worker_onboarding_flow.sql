-- Migration: 202605200001_worker_onboarding_flow.sql
-- Description: Adds the schema surface required by the transactional worker onboarding flow.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS email_domain VARCHAR(255);

UPDATE public.company_settings
SET email_domain = split_part(correo_corporativo, '@', 2)
WHERE email_domain IS NULL
  AND correo_corporativo IS NOT NULL
  AND correo_corporativo LIKE '%@%';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS worker_id UUID,
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_password_change_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_users_worker_id'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_worker_id
      FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_username
  ON public.users(company_id, LOWER(username))
  WHERE deleted_at IS NULL AND username IS NOT NULL;

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS personal_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS paternal_last_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS maternal_last_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS gender VARCHAR(30),
  ADD COLUMN IF NOT EXISTS civil_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS nationality VARCHAR(80),
  ADD COLUMN IF NOT EXISTS secondary_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS district VARCHAR(100),
  ADD COLUMN IF NOT EXISTS province VARCHAR(100),
  ADD COLUMN IF NOT EXISTS department VARCHAR(100),
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES public.job_positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_type_id UUID,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(30) DEFAULT 'created';

UPDATE public.workers
SET start_date = hire_date
WHERE start_date IS NULL
  AND hire_date IS NOT NULL;

ALTER TABLE public.worker_contracts
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS trial_period BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'PEN',
  ADD COLUMN IF NOT EXISTS workday_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS work_mode VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cost_center_id UUID,
  ADD COLUMN IF NOT EXISTS observations TEXT,
  ADD COLUMN IF NOT EXISTS generated_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS signed_file_url TEXT,
  ADD COLUMN IF NOT EXISTS signed_at DATE,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

UPDATE public.worker_contracts wc
SET company_id = w.company_id
FROM public.workers w
WHERE wc.worker_id = w.id
  AND wc.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_worker_contracts_company_id ON public.worker_contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_worker_contracts_worker_id ON public.worker_contracts(worker_id);

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) DEFAULT 'contract',
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

UPDATE public.contract_documents cd
SET worker_id = wc.worker_id,
    company_id = COALESCE(wc.company_id, w.company_id)
FROM public.worker_contracts wc
LEFT JOIN public.workers w ON w.id = wc.worker_id
WHERE cd.contract_id = wc.id
  AND (cd.worker_id IS NULL OR cd.company_id IS NULL);

CREATE TABLE IF NOT EXISTS public.worker_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL,
  file_name VARCHAR(255),
  file_url TEXT NOT NULL,
  file_path TEXT,
  mime_type VARCHAR(100),
  size_bytes INTEGER,
  status VARCHAR(30) DEFAULT 'uploaded',
  uploaded_by UUID REFERENCES public.users(id),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_worker_documents_worker_id ON public.worker_documents(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_documents_company_id ON public.worker_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_worker_documents_document_type ON public.worker_documents(document_type);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON public.audit_logs(company_id);

INSERT INTO public.permissions (id, name, description) VALUES
(uuid_generate_v4(), 'contracts.create', 'Crear contratos laborales'),
(uuid_generate_v4(), 'contracts.generate', 'Generar contratos en PDF'),
(uuid_generate_v4(), 'contracts.upload_signed', 'Subir contratos firmados'),
(uuid_generate_v4(), 'workers.onboarding', 'Ejecutar alta integral de colaborador'),
(uuid_generate_v4(), 'users.suggest_credentials', 'Sugerir credenciales corporativas')
ON CONFLICT (name) DO NOTHING;
