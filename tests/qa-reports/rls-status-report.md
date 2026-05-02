# Reporte de RLS Supabase

## Resumen
- Total tablas public: 57
- Tablas con RLS: 56
- Tablas sin RLS: 1
- Tablas con policies: 45
- Tablas sin policies: 11
- Vistas detectadas: 0
- Riesgo general: PARTIAL GO

## Tablas sin RLS

| Tabla | Tiene company_id | Policies | Riesgo | Recomendación |
|---|---|---|---|---|
| _migrations_tracker | false | 0 | BAJO | Revisar si requiere RLS |

## Tablas con RLS pero sin policies

| Tabla | Riesgo | Recomendación |
|---|---|---|
| approval_steps | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| audit_logs | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| backup_logs | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| contract_documents | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| deleted_records_audit | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| document_acceptances | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| overtime_records | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| request_approvals | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| user_status_history | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| worker_contracts | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |
| worker_status_history | MEDIO | Crear policies para permitir el acceso (actualmente está bloqueada por defecto) |

## Vistas

*No se detectaron vistas en el schema public.*

## Decisión
PARTIAL GO
