-- FABRYOR Admin: canonical contract for the Document Center.

ALTER TABLE public.worker_documents
  ADD COLUMN IF NOT EXISTS content_sha256 VARCHAR(64);

UPDATE public.worker_documents
SET status = 'generated'
WHERE UPPER(document_type) = 'CONSTANCIA_PASSWORD'
  AND LOWER(COALESCE(status, '')) IN ('active', 'uploaded');

UPDATE public.worker_documents
SET status = 'available'
WHERE LOWER(COALESCE(status, '')) IN ('active', 'uploaded');

UPDATE public.worker_documents
SET status = 'pending'
WHERE status IS NULL OR BTRIM(status) = '';

UPDATE public.worker_documents
SET status = 'available'
WHERE deleted_at IS NULL
  AND LOWER(status) NOT IN (
    'missing', 'pending', 'approved', 'rejected', 'observed',
    'generated', 'signed', 'expired', 'available'
  );

UPDATE public.worker_documents
SET status = 'deleted'
WHERE deleted_at IS NOT NULL
  AND LOWER(status) NOT IN (
    'missing', 'pending', 'approved', 'rejected', 'observed',
    'generated', 'signed', 'expired', 'available', 'deleted'
  );

ALTER TABLE public.worker_documents
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.worker_documents
  DROP CONSTRAINT IF EXISTS chk_worker_documents_status;

ALTER TABLE public.worker_documents
  ADD CONSTRAINT chk_worker_documents_status
  CHECK (LOWER(status) IN (
    'missing', 'pending', 'approved', 'rejected', 'observed',
    'generated', 'signed', 'expired', 'available', 'deleted'
  ));

ALTER TABLE public.worker_documents
  DROP CONSTRAINT IF EXISTS chk_worker_documents_content_sha256;

ALTER TABLE public.worker_documents
  ADD CONSTRAINT chk_worker_documents_content_sha256
  CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_documents_company_content_sha256
  ON public.worker_documents(company_id, content_sha256)
  WHERE content_sha256 IS NOT NULL
    AND deleted_at IS NULL
    AND LOWER(status) <> 'deleted';

CREATE INDEX IF NOT EXISTS idx_worker_documents_company_type
  ON public.worker_documents(company_id, document_type)
  WHERE deleted_at IS NULL;
