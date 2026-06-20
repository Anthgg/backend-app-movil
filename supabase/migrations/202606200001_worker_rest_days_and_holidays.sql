BEGIN;

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS rest_day_type VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS fixed_rest_day_of_week INTEGER;

UPDATE public.workers
SET rest_day_type = 'manual'
WHERE rest_day_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workers_rest_day_type_check'
  ) THEN
    ALTER TABLE public.workers
      ADD CONSTRAINT workers_rest_day_type_check
      CHECK (rest_day_type IN ('manual', 'fijo', 'rotativo'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workers_fixed_rest_day_check'
  ) THEN
    ALTER TABLE public.workers
      ADD CONSTRAINT workers_fixed_rest_day_check
      CHECK (fixed_rest_day_of_week IS NULL OR fixed_rest_day_of_week BETWEEN 1 AND 7);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.worker_rest_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT worker_rest_days_type_check CHECK (type IN ('manual', 'fijo', 'rotativo'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'worker_rest_days_type_check'
  ) THEN
    ALTER TABLE public.worker_rest_days
      ADD CONSTRAINT worker_rest_days_type_check
      CHECK (type IN ('manual', 'fijo', 'rotativo'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_worker_rest_days_worker_date
  ON public.worker_rest_days(worker_id, date);

CREATE INDEX IF NOT EXISTS idx_worker_rest_days_company_date
  ON public.worker_rest_days(company_id, date);

CREATE TABLE IF NOT EXISTS public.holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  name VARCHAR(180) NOT NULL,
  country VARCHAR(8) NOT NULL DEFAULT 'PE',
  type VARCHAR(30) NOT NULL DEFAULT 'national',
  is_paid BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_country_date
  ON public.holidays(country, date)
  WHERE is_active = true;

COMMENT ON COLUMN public.workers.fixed_rest_day_of_week IS
  'ISO weekday: 1=lunes, 7=domingo. Solo aplica cuando rest_day_type=fijo.';

COMMENT ON TABLE public.worker_rest_days IS
  'Calendario materializado de descansos manuales, fijos y rotativos por trabajador.';

COMMIT;