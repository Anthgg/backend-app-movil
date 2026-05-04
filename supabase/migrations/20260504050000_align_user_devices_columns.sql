-- Alinear columnas de user_devices para registro y validacion de dispositivos.
-- Migracion incremental segura: no elimina datos ni modifica migraciones antiguas.

ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS device_identifier TEXT,
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS device_name TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS os_version TEXT,
  ADD COLUMN IF NOT EXISTS push_token TEXT,
  ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_authorized BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Si existe device_id, copiarlo a device_identifier cuando falte para compatibilidad.
UPDATE public.user_devices
SET device_identifier = device_id
WHERE device_identifier IS NULL
  AND device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_company_id ON public.user_devices(company_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_device_id ON public.user_devices(device_id);
