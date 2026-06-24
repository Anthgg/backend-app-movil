-- Migration: 202606240001_add_contract_tracking_code.sql
-- Adds an individual, incremental code for generated labor contracts.

ALTER TABLE public.worker_contracts
  ADD COLUMN IF NOT EXISTS contract_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS contract_code VARCHAR(40);

CREATE SEQUENCE IF NOT EXISTS public.worker_contract_code_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

WITH generated_contracts AS (
  SELECT
    wc.id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(wc.created_at, NOW()), wc.id
    ) AS sequence_number
  FROM public.worker_contracts wc
  WHERE wc.contract_code IS NULL
    AND (
      wc.generated_pdf_url IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.contract_documents cd
        WHERE cd.contract_id = wc.id
          AND LOWER(COALESCE(cd.document_type, '')) = 'generated_contract'
      )
    )
)
UPDATE public.worker_contracts wc
SET contract_sequence = generated_contracts.sequence_number,
    contract_code = 'F-RRHH-CTR-' || LPAD(generated_contracts.sequence_number::TEXT, 6, '0'),
    updated_at = NOW()
FROM generated_contracts
WHERE wc.id = generated_contracts.id;

DO $$
DECLARE
  max_contract_sequence BIGINT;
BEGIN
  SELECT COALESCE(MAX(contract_sequence), 0)
  INTO max_contract_sequence
  FROM public.worker_contracts;

  IF max_contract_sequence > 0 THEN
    PERFORM setval('public.worker_contract_code_seq', max_contract_sequence, TRUE);
  ELSE
    PERFORM setval('public.worker_contract_code_seq', 1, FALSE);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_contracts_contract_sequence_unique
  ON public.worker_contracts(contract_sequence)
  WHERE contract_sequence IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_contracts_contract_code_unique
  ON public.worker_contracts(contract_code)
  WHERE contract_code IS NOT NULL;
