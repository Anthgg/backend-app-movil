-- ==========================================
-- 20260504051000_fix_user_devices_upsert.sql
-- ==========================================

-- 1. Agregar columna platform si no existe
ALTER TABLE public.user_devices ADD COLUMN IF NOT EXISTS platform VARCHAR(50);

-- 2. Asegurar que user_id sea único para permitir UPSERT por usuario
-- Primero borramos el índice no único si existe
DROP INDEX IF EXISTS public.idx_user_devices_user_id;
-- Agregamos el constraint único
ALTER TABLE public.user_devices ADD CONSTRAINT user_devices_user_id_key UNIQUE (user_id);

-- 3. Asegurar que device_id sea único para evitar que un dispositivo sea de varios usuarios
-- Primero borramos el índice no único si existe
DROP INDEX IF EXISTS public.idx_user_devices_device_id;
-- Agregamos el constraint único
ALTER TABLE public.user_devices ADD CONSTRAINT user_devices_device_id_key UNIQUE (device_id);

-- 4. Asegurar que device_identifier sea único también si se usa
ALTER TABLE public.user_devices ADD CONSTRAINT user_devices_device_identifier_key UNIQUE (device_identifier);
