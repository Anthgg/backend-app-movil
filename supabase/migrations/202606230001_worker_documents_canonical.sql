-- Migration: 202606230001_worker_documents_canonical.sql
-- Canonical worker document model for web and mobile.
-- The legacy public.documents table is intentionally not used by the backend contract.

ALTER TABLE public.worker_documents
  ALTER COLUMN file_url DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS review_comment TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS due_date DATE;

UPDATE public.worker_documents
SET updated_at = COALESCE(updated_at, uploaded_at, NOW())
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_worker_documents_company_status
  ON public.worker_documents(company_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_worker_documents_worker_status
  ON public.worker_documents(worker_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_worker_documents_uploaded_at
  ON public.worker_documents(uploaded_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_worker_documents_required
  ON public.worker_documents(company_id, worker_id, is_required)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_worker_documents_modtime ON public.worker_documents;
CREATE TRIGGER update_worker_documents_modtime
BEFORE UPDATE ON public.worker_documents
FOR EACH ROW
EXECUTE PROCEDURE update_modified_column();
