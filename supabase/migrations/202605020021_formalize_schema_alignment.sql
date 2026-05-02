-- ============================================================
-- Migration: 202605020021_formalize_schema_alignment.sql
-- Propósito: Formalizar columnas que ya existen en producción
--            gracias a parches manuales, y documentar user_id
--            en attendance_records como columna oficial.
-- ============================================================

-- 1. payroll_periods: asegurar year, month y company_id existen
--    (ya definidas en migration 18, pero añadimos IF NOT EXISTS
--     por seguridad ante entornos que no hayan aplicado la migración base)
ALTER TABLE public.payroll_periods
  ADD COLUMN IF NOT EXISTS year    INTEGER,
  ADD COLUMN IF NOT EXISTS month   INTEGER,
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- 2. Asegurar restricción UNIQUE en (company_id, year, month) si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_periods_company_id_year_month_key'
      AND conrelid = 'public.payroll_periods'::regclass
  ) THEN
    ALTER TABLE public.payroll_periods
      ADD CONSTRAINT payroll_periods_company_id_year_month_key
      UNIQUE (company_id, year, month);
  END IF;
END $$;

-- 3. attendance_records.user_id: columna oficial backfilleada
--    Se documenta como columna que relaciona el registro con el
--    usuario directamente (además del worker_id) para soportar
--    queries de reportes y JOINs con la tabla users.
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_records_user_id
  ON public.attendance_records(user_id);

-- 4. Backfill user_id desde workers si aún hay registros sin llenar
UPDATE public.attendance_records ar
SET user_id = w.user_id
FROM public.workers w
WHERE ar.worker_id = w.id
  AND ar.user_id IS NULL;

-- 5. Trigger para mantener user_id sincronizado con worker_id en inserts futuros
CREATE OR REPLACE FUNCTION sync_attendance_user_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.worker_id IS NOT NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.workers
    WHERE id = NEW.worker_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_attendance_user_id ON public.attendance_records;
CREATE TRIGGER trg_sync_attendance_user_id
BEFORE INSERT ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION sync_attendance_user_id();

-- 6. users: confirmar columnas first_name y last_name como campos oficiales
--    (definidas en migration 01, documentamos que full_name NO es columna física oficial)
COMMENT ON COLUMN public.users.first_name IS 'Nombre(s) del usuario. Campo oficial. Usar CONCAT_WS para obtener full_name.';
COMMENT ON COLUMN public.users.last_name  IS 'Apellido(s) del usuario. Campo oficial.';

-- ============================================================
-- VERIFICACIÓN POSTERIOR (ejecutar por separado):
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'payroll_periods' AND column_name IN ('year','month','company_id');
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'attendance_records' AND column_name = 'user_id';
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name IN ('first_name','last_name');
