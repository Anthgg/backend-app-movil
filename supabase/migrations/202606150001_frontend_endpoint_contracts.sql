-- Align frontend-facing user preferences and labor policy defaults.

ALTER TABLE public.users
  ALTER COLUMN ui_preferences SET DEFAULT '{
    "theme": "light",
    "language": "es",
    "sidebarCollapsed": false,
    "density": "comfortable",
    "accentColor": "green"
  }'::jsonb;

UPDATE public.users
SET ui_preferences = '{
  "theme": "light",
  "language": "es",
  "sidebarCollapsed": false,
  "density": "comfortable",
  "accentColor": "green"
}'::jsonb
WHERE ui_preferences = '{
  "theme": "system",
  "density": "comfortable",
  "accentColor": "green"
}'::jsonb;

UPDATE public.users
SET ui_preferences = '{
  "theme": "light",
  "language": "es",
  "sidebarCollapsed": false,
  "density": "comfortable",
  "accentColor": "green"
}'::jsonb || COALESCE(ui_preferences, '{}'::jsonb)
WHERE ui_preferences IS NULL
   OR NOT (ui_preferences ? 'theme')
   OR NOT (ui_preferences ? 'language')
   OR NOT (ui_preferences ? 'sidebarCollapsed');

ALTER TABLE public.company_labor_policies
  ALTER COLUMN late_tolerance_minutes SET DEFAULT 15,
  ALTER COLUMN auto_absence_after_time SET DEFAULT '04:00',
  ALTER COLUMN default_break_minutes SET DEFAULT 45,
  ALTER COLUMN working_days SET DEFAULT '["monday","tuesday","wednesday","thursday","friday","saturday"]'::jsonb;

UPDATE public.company_labor_policies
SET
  late_tolerance_minutes = 15,
  auto_absence_after_time = '04:00',
  default_break_minutes = 45,
  updated_at = NOW()
WHERE late_tolerance_minutes = 5
  AND auto_absence_after_time = '23:59'
  AND default_break_minutes = 60;
