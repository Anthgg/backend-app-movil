-- Agregar columna ui_preferences a la tabla users para persistir preferencias visuales del frontend
ALTER TABLE users
ADD COLUMN IF NOT EXISTS ui_preferences JSONB NOT NULL DEFAULT '{
  "theme": "system",
  "density": "comfortable",
  "accentColor": "green"
}'::jsonb;

COMMENT ON COLUMN users.ui_preferences IS 'Preferencias visuales del usuario en el frontend (theme, density, accentColor).';
