CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  refresh_token_id UUID REFERENCES public.refresh_tokens(id) ON DELETE SET NULL,
  refresh_token_hash TEXT NOT NULL,
  ip_address VARCHAR(100),
  user_agent TEXT,
  browser VARCHAR(100),
  os VARCHAR(100),
  device_type VARCHAR(50),
  device_name VARCHAR(150),
  is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  trusted_at TIMESTAMP WITH TIME ZONE,
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_activity_update_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_reason VARCHAR(100),
  expires_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.refresh_tokens
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.user_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON public.user_sessions(user_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_id
  ON public.user_sessions(refresh_token_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id
  ON public.refresh_tokens(session_id);
