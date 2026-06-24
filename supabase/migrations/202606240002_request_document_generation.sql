-- Migration: 202606240002_request_document_generation.sql
-- Adds formal request document generation support and unique request codes.

ALTER TABLE public.employee_requests
  ADD COLUMN IF NOT EXISTS request_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS request_code VARCHAR(50);

CREATE SEQUENCE IF NOT EXISTS public.employee_request_code_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

WITH typed_requests AS (
  SELECT
    er.id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(er.created_at, NOW()), er.id
    ) AS sequence_number,
    UPPER(
      REGEXP_REPLACE(
        TRANSLATE(
          COALESCE(rt.code, rt.name, ''),
          U&'\00C1\00C9\00CD\00D3\00DA\00DC\00D1\00E1\00E9\00ED\00F3\00FA\00FC\00F1',
          'AEIOUUNaeiouun'
        ),
        '[^A-Za-z0-9]+',
        '_',
        'g'
      )
    ) AS type_token
  FROM public.employee_requests er
  LEFT JOIN public.request_types rt ON rt.id = er.request_type_id
  WHERE er.request_code IS NULL
),
generated_requests AS (
  SELECT
    id,
    sequence_number,
    CASE
      WHEN type_token IN ('VACATION', 'VAC', 'VACACIONES', 'DESCANSO_VACACIONAL') THEN 'VAC'
      WHEN type_token IN ('MEDICAL_LEAVE', 'MEDICAL', 'DESCANSO_MEDICO', 'DESCANSO', 'DM') THEN 'DME'
      WHEN type_token IN ('UNPAID_LEAVE', 'PERSONAL_PERMISSION', 'PERMISO_PERSONAL', 'PERMISO', 'LEAVE_PERMISSION') THEN 'PER'
      WHEN type_token IN ('ABSENCE_JUSTIFICATION', 'JUSTIFICACION_INASISTENCIA', 'JUSTIFICACION_DE_INASISTENCIA', 'INASISTENCIA', 'ABSENCE') THEN 'JIN'
      WHEN type_token IN ('SHIFT_CHANGE', 'SCHEDULE_CHANGE', 'CAMBIO_HORARIO', 'CAMBIO_DE_HORARIO', 'CAMBIO_TURNO', 'CAMBIO_DE_TURNO') THEN 'CHO'
      WHEN type_token IN ('FAMILY_SERIOUS_ILLNESS_LEAVE', 'FAMILY_LEAVE', 'LICENCIA_FAMILIAR_GRAVE', 'LICENCIA_POR_FAMILIAR_GRAVE', 'FAMILIAR_GRAVE') THEN 'LFG'
      ELSE 'SOL'
    END AS prefix
  FROM typed_requests
)
UPDATE public.employee_requests er
SET request_sequence = generated_requests.sequence_number,
    request_code = 'F-RRHH-SOL-' || generated_requests.prefix || '-' || LPAD(generated_requests.sequence_number::TEXT, 6, '0'),
    updated_at = NOW()
FROM generated_requests
WHERE er.id = generated_requests.id;

DO $$
DECLARE
  max_request_sequence BIGINT;
BEGIN
  SELECT COALESCE(MAX(request_sequence), 0)
  INTO max_request_sequence
  FROM public.employee_requests;

  IF max_request_sequence > 0 THEN
    PERFORM setval('public.employee_request_code_seq', max_request_sequence, TRUE);
  ELSE
    PERFORM setval('public.employee_request_code_seq', 1, FALSE);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_requests_request_sequence_unique
  ON public.employee_requests(request_sequence)
  WHERE request_sequence IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_requests_request_code_unique
  ON public.employee_requests(request_code)
  WHERE request_code IS NOT NULL;

ALTER TABLE public.request_documents
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE public.request_documents
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

ALTER TABLE public.request_documents
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_request_documents_generated_documents
  ON public.request_documents(company_id, request_id, document_type, status)
  WHERE document_type IN ('generated_request_document', 'signed_request_document');

INSERT INTO public.permissions (id, name, description) VALUES
  (uuid_generate_v4(), 'requests.documents.generate', 'Generar PDF formal de solicitudes laborales'),
  (uuid_generate_v4(), 'requests.documents.sign', 'Subir documento formal firmado de solicitudes laborales')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN ('requests.documents.generate', 'requests.documents.sign')
WHERE UPPER(COALESCE(r.code, r.name)) IN ('ADMIN', 'RRHH', 'TRABAJADOR')
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.employee_requests.request_code IS
  'Formal unique code used in generated request PDFs, e.g. F-RRHH-SOL-DME-000001.';
