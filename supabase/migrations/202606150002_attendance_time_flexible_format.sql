BEGIN;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS check_in_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS check_out_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS check_in_source_format VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS check_out_source_format VARCHAR(32) NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_records_check_in_at
  ON public.attendance_records(check_in_at);

CREATE INDEX IF NOT EXISTS idx_attendance_records_check_out_at
  ON public.attendance_records(check_out_at);

COMMENT ON COLUMN public.attendance_records.check_in_at IS
  'Timestamp completo de cliente o servidor usado para auditar la marcacion de entrada.';

COMMENT ON COLUMN public.attendance_records.check_out_at IS
  'Timestamp completo de cliente o servidor usado para auditar la marcacion de salida.';

COMMENT ON COLUMN public.attendance_records.check_in_source_format IS
  'Formato original normalizado para la hora de entrada: HH:mm:ss, HH:mm, datetime, date_object o server_now.';

COMMENT ON COLUMN public.attendance_records.check_out_source_format IS
  'Formato original normalizado para la hora de salida: HH:mm:ss, HH:mm, datetime, date_object o server_now.';

COMMIT;
