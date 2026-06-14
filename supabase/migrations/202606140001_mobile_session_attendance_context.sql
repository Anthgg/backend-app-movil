ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES public.workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS platform VARCHAR(50),
  ADD COLUMN IF NOT EXISTS app_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS browser_version VARCHAR(80),
  ADD COLUMN IF NOT EXISTS os_version VARCHAR(80),
  ADD COLUMN IF NOT EXISTS device_model VARCHAR(150),
  ADD COLUMN IF NOT EXISTS region VARCHAR(100),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(100);

UPDATE public.user_sessions
SET source = CASE
    WHEN LOWER(COALESCE(platform, '')) IN ('android', 'ios') THEN 'mobile_app'
    ELSE COALESCE(source, 'web')
  END,
  platform = COALESCE(platform, CASE WHEN COALESCE(source, 'web') = 'web' THEN 'browser' ELSE platform END),
  updated_at = NOW()
WHERE source IS NULL OR platform IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_worker_active
  ON public.user_sessions(worker_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_source
  ON public.user_sessions(company_id, source, last_activity_at DESC);

ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS app_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS build_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.user_devices
SET device_fingerprint = COALESCE(device_fingerprint, device_identifier, device_id),
    updated_at = COALESCE(updated_at, NOW())
WHERE device_fingerprint IS NULL
   OR updated_at IS NULL;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS check_in_session_id UUID REFERENCES public.user_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS check_out_session_id UUID REFERENCES public.user_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS check_in_device_source VARCHAR(50),
  ADD COLUMN IF NOT EXISTS check_out_device_source VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_attendance_records_check_in_session
  ON public.attendance_records(check_in_session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_check_out_session
  ON public.attendance_records(check_out_session_id);
