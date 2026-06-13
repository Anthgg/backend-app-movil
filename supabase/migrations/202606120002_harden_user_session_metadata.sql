ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100),
  ADD COLUMN IF NOT EXISTS location VARCHAR(255),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS browser VARCHAR(100),
  ADD COLUMN IF NOT EXISTS os VARCHAR(100),
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS device_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS trust_available_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_activity_update_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(100),
  ALTER COLUMN is_trusted SET DEFAULT FALSE,
  ALTER COLUMN last_activity_at SET DEFAULT NOW(),
  ALTER COLUMN last_activity_update_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE public.user_sessions
SET browser = NULL,
    updated_at = NOW()
WHERE browser IS NOT NULL
  AND (
    browser = id::text
    OR browser ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

UPDATE public.user_sessions
SET device_name = NULL,
    updated_at = NOW()
WHERE device_name IS NOT NULL
  AND (
    btrim(device_name) = 'Sesion activa'
    OR device_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

UPDATE public.user_sessions
SET device_type = 'unknown',
    updated_at = NOW()
WHERE device_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity
  ON public.user_sessions(user_id, last_activity_at DESC);
