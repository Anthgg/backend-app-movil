CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.company_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL UNIQUE,
  max_crews_per_supervisor INTEGER NOT NULL DEFAULT 2,
  exceed_action VARCHAR(20) NOT NULL DEFAULT 'block',
  allowed_roles_for_supervisor JSONB NOT NULL DEFAULT '["supervisor"]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT company_rules_exceed_action_check
    CHECK (exceed_action IN ('block', 'warn')),

  CONSTRAINT company_rules_max_crews_check
    CHECK (max_crews_per_supervisor >= 1),

  CONSTRAINT company_rules_company_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_company_rules_company_id
  ON public.company_rules(company_id);

DROP TRIGGER IF EXISTS update_company_rules_updated_at ON public.company_rules;
CREATE TRIGGER update_company_rules_updated_at
  BEFORE UPDATE ON public.company_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_modified_column();

INSERT INTO public.company_rules (
  company_id,
  max_crews_per_supervisor,
  exceed_action,
  allowed_roles_for_supervisor
)
SELECT
  c.id,
  2,
  'block',
  '["supervisor"]'::jsonb
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.company_rules cr
  WHERE cr.company_id = c.id
);
