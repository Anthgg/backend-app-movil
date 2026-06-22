# Contrato de analitica de asistencia

El backend es la unica fuente de verdad para faltas, tardanzas, vacaciones, descansos medicos, permisos personales, feriados, descansos y dias sin horario. React y Flutter deben enviar filtros y pintar la respuesta; no deben reconstruir estados ni porcentajes.

## Endpoint principal

```http
GET /api/attendance/analytics/dashboard?month=2026-06&limit=10
Authorization: Bearer <token>
```

Para Flutter tambien esta montado bajo:

```http
GET /api/mobile/attendance/analytics/dashboard?month=2026-06&limit=10
```

La respuesta contiene:

- `kpis`: contadores, minutos, horas, porcentajes y score ya calculados.
- `rankings`: trabajadores, areas, obras y cuadrillas ordenados, con `rank`, `label`, `value` y `secondaryValue`.
- `charts.statusDistribution`: segmentos con `key`, `label`, `value` y `percentage`.
- `charts.dailyTrend` y `charts.weeklyTrend`: series completas del periodo.
- `charts.byArea`, `byDepartment`, `byWorkLocation` y `byCrew`: agrupaciones normalizadas.

`presentCount` incluye toda marcacion valida, tambien las tardanzas. Para graficos disjuntos se usan `onTimeCount` y `lateCount`.

## Filtros

Todos los endpoints aceptan `month=YYYY-MM` o el par `startDate/endDate` (tambien `start_date/end_date`). El rango maximo es 366 dias.

Filtros de dimension: `workerId`, `areaId`, `departmentId`, `positionId`, `workLocationId`, `crewId`. Se aceptan tambien sus equivalentes `snake_case`.

Filtro de estado: `status=PRESENT,LATE,ABSENT`. Valores canonicos de respuesta:

```text
present, late, absent, vacation, medical_leave, unpaid_leave,
holiday, rest_day, no_schedule, incomplete, pending
```

## Endpoints especializados

```text
GET  /api/attendance/analytics/today
GET  /api/attendance/analytics/monthly
GET  /api/attendance/analytics/workers
GET  /api/attendance/analytics/workers/:workerId/summary
GET  /api/attendance/analytics/areas
GET  /api/attendance/analytics/departments
GET  /api/attendance/analytics/work-locations
GET  /api/attendance/analytics/crews
GET  /api/attendance/analytics/trends/daily
GET  /api/attendance/analytics/trends/weekly
GET  /api/attendance/analytics/rankings/absences
GET  /api/attendance/analytics/rankings/lates
GET  /api/attendance/analytics/rankings/best-attendance
GET  /api/attendance/analytics/rankings/areas/absences
GET  /api/attendance/analytics/rankings/areas/lates
GET  /api/attendance/analytics/rankings/work-locations/absences
GET  /api/attendance/analytics/rankings/work-locations/lates
GET  /api/attendance/analytics/rankings/work-locations/best-attendance
GET  /api/attendance/analytics/rankings/crews/absences
GET  /api/attendance/analytics/rankings/crews/lates
GET  /api/attendance/analytics/rankings/crews/best-attendance
GET  /api/attendance/analytics/kpis
POST /api/attendance/analytics/recalculate
```

`recalculate` requiere `manage_attendance`, ejecuta un calculo en vivo y no persiste un resumen. Devuelve `meta.persisted=false`.

## Reglas de negocio

Una fecha sin check-in solo es falta cuando el contrato estaba vigente, existia turno, el dia pertenecia al turno y no habia feriado, descanso ni solicitud aprobada. Las prioridades son:

1. Solicitud aprobada: vacaciones, descanso medico o permiso personal.
2. Estado laboral materializado en asistencia.
3. Feriado.
4. Sin horario o dia de descanso.
5. Marcacion incompleta, tardanza o asistencia.
6. Falta para fechas pasadas; el dia actual sin marcacion queda pendiente.

Las fechas futuras no participan en el denominador de `scheduledWorkDays`. Las asignaciones historicas de turno, obra y cuadrilla se resuelven por fecha.
