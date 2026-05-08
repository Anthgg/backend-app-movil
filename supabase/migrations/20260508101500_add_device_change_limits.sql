ALTER TABLE public.user_devices
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(100);

UPDATE public.user_devices
SET is_active = COALESCE(is_authorized, true)
WHERE is_active IS NULL;

CREATE TABLE IF NOT EXISTS public.device_change_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    action VARCHAR(50) NOT NULL,
    month_key VARCHAR(7) NOT NULL,
    ip_address VARCHAR(100),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_change_logs_user_month
ON public.device_change_logs(user_id, month_key);
