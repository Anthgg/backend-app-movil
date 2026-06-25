BEGIN;

WITH candidates AS (
  SELECT
    ar.id,
    COALESCE(
      NULLIF(s.timezone, ''),
      NULLIF(ar.calculation_details->>'timezone', ''),
      'America/Lima'
    ) AS timezone,
    (
      ar.date::date
      + INTERVAL '1 day'
      + COALESCE(s.end_time, ar.scheduled_check_out)
    ) AT TIME ZONE COALESCE(
      NULLIF(s.timezone, ''),
      NULLIF(ar.calculation_details->>'timezone', ''),
      'America/Lima'
    ) AS corrected_check_out
  FROM public.attendance_records ar
  LEFT JOIN public.shifts s ON s.id = ar.shift_id
  WHERE ar.check_in_time IS NOT NULL
    AND ar.check_out_time IS NOT NULL
    AND ar.check_out_time <= ar.check_in_time
    AND COALESCE(ar.auto_closed, FALSE) = TRUE
    AND COALESCE(s.start_time, ar.scheduled_check_in) IS NOT NULL
    AND COALESCE(s.end_time, ar.scheduled_check_out) IS NOT NULL
    AND COALESCE(s.end_time, ar.scheduled_check_out) <= COALESCE(s.start_time, ar.scheduled_check_in)
),
repaired AS (
  SELECT
    ar.id,
    c.timezone,
    c.corrected_check_out,
    GREATEST(
      FLOOR(EXTRACT(EPOCH FROM (c.corrected_check_out - ar.check_in_time)) / 60)::integer,
      0
    ) AS corrected_worked_minutes
  FROM public.attendance_records ar
  JOIN candidates c ON c.id = ar.id
  WHERE c.corrected_check_out > ar.check_in_time
)
UPDATE public.attendance_records ar
SET check_out_time = repaired.corrected_check_out,
    worked_minutes = repaired.corrected_worked_minutes,
    worked_hours = ROUND((repaired.corrected_worked_minutes::numeric / 60), 2),
    hours_worked = ROUND((repaired.corrected_worked_minutes::numeric / 60), 2),
    calculation_details = COALESCE(ar.calculation_details, '{}'::jsonb)
      || jsonb_build_object(
        'auto_checkout_scheduled_at',
        to_char(repaired.corrected_check_out AT TIME ZONE repaired.timezone, 'YYYY-MM-DD HH24:MI:SS') || ' ' || repaired.timezone,
        'auto_checkout_repaired_at',
        NOW()
      ),
    updated_at = NOW()
FROM repaired
WHERE repaired.id = ar.id;

COMMIT;
