# Reporte de Restricciones y RLS de Base de Datos

**Fecha de validación:** 2/5/2026, 4:49:19 a. m.

## 1. Tablas Protegidas con RLS
- [x] companies
- [x] users
- [x] roles
- [x] permissions
- [x] role_permissions
- [x] user_roles
- [x] workers
- [x] job_positions
- [x] departments
- [x] projects
- [x] project_assignments
- [x] work_schedules
- [x] shifts
- [x] worker_shifts
- [x] attendance_records
- [x] attendance_evidence
- [x] attendance_corrections
- [x] employee_requests
- [x] request_types
- [x] request_documents
- [x] vacations
- [x] leave_balances
- [x] medical_leaves
- [x] documents
- [x] document_types
- [x] payroll_periods
- [x] payroll_records
- [x] payroll_concepts
- [x] payroll_record_items
- [x] payroll_adjustments
- [x] generated_reports
- [x] job_runs
- [x] audit_logs
- [x] user_devices
- [x] notifications

## 2. Restricciones Agregadas
- RLS Activado en 35 tablas sensibles.
- Políticas (SELECT, INSERT, UPDATE, DELETE) forzadas por company_id.
- Foreign Keys agregadas a workers, attendance, requests, payroll.
- Índices únicos en trabajadores, usuarios, asistencia y reportes.
- Check constraints en estados de usuarios, asistencia, permisos y periodos.
- Soft deletes estandarizados en tablas core.

## 3. Restricciones No Agregadas
- Ninguna, la migración DO $$ garantiza idempotencia sin dropear datos.

## 4. Gestión de Duplicados
Si existen duplicados, la migración imprime WARNINGS pero no rompe la BD.

## 5. Riesgos Pendientes
- El backend debe asegurar usar SELECT * con service_role solo donde sea estrictamente necesario.
