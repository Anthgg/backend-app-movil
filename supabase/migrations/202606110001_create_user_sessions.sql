CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  refresh_token_id UUID REFERENCES public.refresh_tokens(id) ON DELETE SET NULL,
  refresh_token_hash TEXT NOT NULL,
  ip_address VARCHAR(100),
  user_agent TEXT,
  browser VARCHAR(100),
  os VARCHAR(100),
  device_type VARCHAR(50),
  device_name VARCHAR(150),
  is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  trust_available_at TIMESTAMP WITH TIME ZONE,
  trusted_at TIMESTAMP WITH TIME ZONE,
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_activity_update_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_reason VARCHAR(100),
  expires_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_id UUID REFERENCES public.refresh_tokens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100),
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS browser VARCHAR(100),
  ADD COLUMN IF NOT EXISTS os VARCHAR(100),
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS device_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trust_available_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_activity_update_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(100),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.refresh_tokens
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.user_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON public.user_sessions(user_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_id
  ON public.user_sessions(refresh_token_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
  ON public.user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_revoked_at
  ON public.user_sessions(revoked_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_is_trusted
  ON public.user_sessions(is_trusted);

CREATE INDEX IF NOT EXISTS idx_user_sessions_company_id
  ON public.user_sessions(company_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id
  ON public.refresh_tokens(session_id);
