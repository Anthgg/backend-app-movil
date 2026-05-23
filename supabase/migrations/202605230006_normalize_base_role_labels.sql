-- Keep role code as the stable RBAC identifier and role name as the visible UI label.
WITH source_roles (code, name, description) AS (
  VALUES
    ('ADMIN', 'Administrador', 'Administrador del sistema'),
    ('RRHH', 'Recursos Humanos', 'Gestion de personal y contratacion'),
    ('SUPERVISOR', 'Supervisor', 'Supervision operativa y de obra'),
    ('TRABAJADOR', 'Trabajador', 'Trabajador regular'),
    ('LOGISTICA', 'Logistica', 'Gestion logistica, compras y almacen'),
    ('CONTABILIDAD', 'Contabilidad', 'Gestion contable y financiera'),
    ('GERENCIA', 'Gerencia', 'Direccion y aprobaciones gerenciales'),
    ('SEGURIDAD', 'Seguridad y SST', 'Seguridad y salud en el trabajo'),
    ('SISTEMAS', 'Sistemas', 'Soporte tecnico y administracion de sistemas')
)
UPDATE public.roles role
SET name = source.name,
    description = source.description,
    updated_at = NOW()
FROM source_roles source
WHERE role.deleted_at IS NULL
  AND UPPER(COALESCE(role.code, role.name)) = source.code;
