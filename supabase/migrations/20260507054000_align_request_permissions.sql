INSERT INTO public.permissions (name, description) VALUES
  ('requests.update_own', 'Actualizar solicitudes propias'),
  ('requests.cancel_own', 'Cancelar solicitudes propias'),
  ('requests.delete_own', 'Eliminar solicitudes propias'),
  ('requests.read_all', 'Ver solicitudes globales')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN (
  'requests.read_own',
  'requests.create',
  'requests.update_own',
  'requests.cancel_own',
  'requests.delete_own'
)
WHERE r.name = 'TRABAJADOR'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN (
  'requests.read_company',
  'requests.approve',
  'requests.reject',
  'requests.observe'
)
WHERE r.name = 'RRHH'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN (
  'requests.read_company',
  'requests.read_all',
  'requests.approve',
  'requests.reject',
  'requests.observe'
)
WHERE r.name = 'ADMIN'
ON CONFLICT DO NOTHING;
