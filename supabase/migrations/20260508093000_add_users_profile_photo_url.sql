ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
