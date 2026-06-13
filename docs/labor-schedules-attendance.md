# Horarios, turnos y asistencia

## Diagnostico aplicado

- `work_schedules` queda como tabla legacy/prototipo. El modulo formal usa `shifts`.
- `workers.shift_id` y `worker_shifts` se mantienen por compatibilidad, pero la fuente formal de historial es `worker_shift_assignments`.
- La asistencia movil conserva `/attendance`, `/api/attendance` y `/api/mobile/attendance`.
- El backend calcula tardanza, horas esperadas, horas efectivas, break y descuentos. El movil no debe enviar calculos finales.

## Permisos

- Admin y RRHH pueden crear, editar, desactivar y asignar turnos.
- Trabajadores solo consultan su horario propio y marcan asistencia desde movil.
- Permisos nuevos: `labor_policies.read`, `labor_policies.manage`, `schedule.assignments.read`, `schedule.assignments.manage`, `shifts.manage`, `attendance.read`, `jobs.execute`.

## Endpoints web

- `GET /api/schedule/policies`
- `PUT /api/schedule/policies`
- `GET /api/schedule/shifts`
- `POST /api/schedule/shifts`
- `GET /api/schedule/shifts/:id`
- `PUT /api/schedule/shifts/:id`
- `DELETE /api/schedule/shifts/:id`
- `GET /api/schedule/assignments`
- `POST /api/schedule/assignments`
- `GET /api/schedule/workers/:id/schedule?date=YYYY-MM-DD`
- `GET /api/schedule/attendance-summary?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

## Endpoints trabajador/movil

- `GET /api/schedule/profile/my-schedule?date=YYYY-MM-DD`
- `GET /api/schedule/profile/my-shift?date=YYYY-MM-DD`
- `POST /api/mobile/attendance/check-in`
- `POST /api/mobile/attendance/check-out`
- `GET /api/mobile/attendance/today`
- `GET /api/mobile/attendance/history`
- `GET /api/mobile/attendance/summary`

## Payload de turno

```json
{
  "name": "Turno 08-17",
  "start_time": "08:00",
  "end_time": "17:00",
  "tolerance_minutes": 5,
  "break_minutes": 60,
  "break_paid": false,
  "weekly_target_minutes": 2880,
  "allows_overtime": true,
  "working_days": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
  "timezone": "America/Lima",
  "is_active": true
}
```

## Reglas

- Si el turno inicia 08:00, 08:00 a 08:05 no es tardanza.
- Desde 08:06 se registra `status = late` y `late_minutes = 6`.
- Jornada 08:00-17:00 con break no pagado de 60 minutos genera 540 minutos presenciales y 480 efectivos.
- Jornada 08:00-16:00 sin break genera 480 minutos efectivos.
- El job de faltas solo genera ausencia si el dia es laboral, el trabajador ya fue dado de alta, tiene turno vigente, no tiene asistencia y no tiene solicitud aprobada.
- Payroll usa contrato activo o sueldo base del puesto, horas esperadas del horario, horas efectivas, faltas y tardanzas.
