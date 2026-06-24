-- Migration: 202606240004_request_documents_mobile_backfill.sql
-- Mirrors generated/signed request documents into worker_documents, the mobile documents source.

INSERT INTO public.worker_documents (
  worker_id,
  company_id,
  document_type,
  title,
  file_name,
  file_url,
  file_path,
  mime_type,
  size_bytes,
  status,
  uploaded_by,
  uploaded_at,
  metadata
)
SELECT
  er.worker_id,
  rd.company_id,
  rd.document_type,
  CASE
    WHEN rd.document_type = 'signed_request_document' THEN
      TRIM(CONCAT('Solicitud laboral firmada ', COALESCE(er.request_code, ''), ' - ', INITCAP(REPLACE(COALESCE(rt.name, 'Solicitud laboral'), '_', ' '))))
    ELSE
      TRIM(CONCAT('Solicitud laboral generada ', COALESCE(er.request_code, ''), ' - ', INITCAP(REPLACE(COALESCE(rt.name, 'Solicitud laboral'), '_', ' '))))
  END AS title,
  COALESCE(
    NULLIF(REGEXP_REPLACE(COALESCE(rd.file_path, ''), '^.*/', ''), ''),
    rd.document_type || '.pdf'
  ) AS file_name,
  rd.file_url,
  rd.file_path,
  rd.mime_type,
  rd.file_size,
  CASE
    WHEN rd.document_type = 'signed_request_document' THEN 'signed'
    WHEN rd.document_type = 'generated_request_document' THEN 'generated'
    ELSE COALESCE(rd.status, 'uploaded')
  END AS status,
  rd.uploaded_by,
  COALESCE(rd.created_at, NOW()) AS uploaded_at,
  COALESCE(rd.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'request_document_backfill',
      'request_id', rd.request_id,
      'request_document_id', rd.id,
      'request_code', er.request_code
    ) AS metadata
FROM public.request_documents rd
JOIN public.employee_requests er ON er.id = rd.request_id
LEFT JOIN public.request_types rt ON rt.id = er.request_type_id
WHERE rd.document_type IN ('generated_request_document', 'signed_request_document')
  AND rd.file_url IS NOT NULL
  AND rd.file_url <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.worker_documents wd
    WHERE wd.worker_id = er.worker_id
      AND wd.company_id = rd.company_id
      AND wd.deleted_at IS NULL
      AND (
        wd.file_path = rd.file_path
        OR wd.metadata->>'request_document_id' = rd.id::text
      )
  );

CREATE INDEX IF NOT EXISTS idx_worker_documents_request_document_id
  ON public.worker_documents ((metadata->>'request_document_id'))
  WHERE deleted_at IS NULL
    AND metadata ? 'request_document_id';
