CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  device_id VARCHAR(255),
  device_fingerprint VARCHAR(128) NOT NULL,
  user_agent TEXT,
  browser VARCHAR(100),
  os VARCHAR(100),
  device_type VARCHAR(50) DEFAULT 'unknown',
  device_name VARCHAR(150),
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_ip_address VARCHAR(100),
  last_location VARCHAR(255),
  last_country VARCHAR(100),
  last_city VARCHAR(100),
  last_latitude DECIMAL(10, 7),
  last_longitude DECIMAL(10, 7),
  is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  trusted_at TIMESTAMP WITH TIME ZONE,
  trust_expires_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_reason VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trusted_devices
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT uuid_generate_v4(),
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128),
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS browser VARCHAR(100),
  ADD COLUMN IF NOT EXISTS os VARCHAR(100),
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(50) DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS device_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_ip_address VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_location VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_latitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS last_longitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS trust_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(100),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

UPDATE public.trusted_devices
SET id = uuid_generate_v4()
WHERE id IS NULL;

UPDATE public.trusted_devices
SET device_fingerprint = device_id
WHERE device_fingerprint IS NULL
  AND device_id IS NOT NULL;

UPDATE public.trusted_devices
SET device_id = device_fingerprint
WHERE device_id IS NULL
  AND device_fingerprint IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.trusted_devices'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.trusted_devices
      ADD CONSTRAINT trusted_devices_pkey PRIMARY KEY (id);
  END IF;
END $$;

WITH ranked_devices AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, device_fingerprint
           ORDER BY is_trusted DESC,
                    trusted_at DESC NULLS LAST,
                    last_seen_at DESC NULLS LAST,
                    created_at DESC NULLS LAST,
                    id
         ) AS row_number
  FROM public.trusted_devices
  WHERE user_id IS NOT NULL
    AND device_fingerprint IS NOT NULL
)
DELETE FROM public.trusted_devices td
USING ranked_devices rd
WHERE td.id = rd.id
  AND rd.row_number > 1;

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS trusted_device_id UUID REFERENCES public.trusted_devices(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_devices_user_fingerprint_unique
  ON public.trusted_devices(user_id, device_fingerprint);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_active
  ON public.trusted_devices(user_id, revoked_at, is_trusted);

CREATE INDEX IF NOT EXISTS idx_user_sessions_trusted_device_id
  ON public.user_sessions(trusted_device_id);

INSERT INTO public.trusted_devices (
  user_id, company_id, device_id, device_fingerprint, user_agent, browser, os, device_type, device_name,
  last_ip_address, last_location, last_country, last_city, last_latitude, last_longitude,
  first_seen_at, last_seen_at, created_at, updated_at
)
SELECT DISTINCT ON (user_id, device_fingerprint)
  user_id,
  company_id,
  device_fingerprint,
  device_fingerprint,
  user_agent,
  browser,
  os,
  COALESCE(device_type, 'unknown'),
  device_name,
  ip_address,
  location,
  country,
  city,
  latitude,
  longitude,
  COALESCE(created_at, NOW()),
  COALESCE(last_activity_at, created_at, NOW()),
  COALESCE(created_at, NOW()),
  NOW()
FROM public.user_sessions
WHERE device_fingerprint IS NOT NULL
ON CONFLICT (user_id, device_fingerprint) DO NOTHING;

UPDATE public.trusted_devices td
SET is_trusted = TRUE,
    trusted_at = COALESCE(td.trusted_at, trusted.latest_trusted_at, NOW()),
    trust_expires_at = COALESCE(td.trust_expires_at, trusted.latest_trusted_at + INTERVAL '30 days', NOW() + INTERVAL '30 days'),
    updated_at = NOW()
FROM (
  SELECT user_id,
         device_fingerprint,
         MAX(trusted_at) AS latest_trusted_at
  FROM public.user_sessions
  WHERE device_fingerprint IS NOT NULL
    AND is_trusted = TRUE
  GROUP BY user_id, device_fingerprint
) trusted
WHERE td.user_id = trusted.user_id
  AND td.device_fingerprint = trusted.device_fingerprint;

UPDATE public.user_sessions us
SET trusted_device_id = td.id,
    updated_at = NOW()
FROM public.trusted_devices td
WHERE us.trusted_device_id IS NULL
  AND us.user_id = td.user_id
  AND us.device_fingerprint = td.device_fingerprint;
