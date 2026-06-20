-- Preserve historical shift assignments when a worker changes shifts.
-- Each previous assignment ends the day before the next one starts.
WITH ordered_assignments AS (
  SELECT id,
         LEAD(effective_from) OVER (
           PARTITION BY company_id, worker_id
           ORDER BY effective_from, created_at, id
         ) AS next_effective_from
  FROM public.worker_shift_assignments
)
UPDATE public.worker_shift_assignments assignment
SET effective_to = (ordered.next_effective_from - INTERVAL '1 day')::date,
    is_active = false,
    updated_at = NOW()
FROM ordered_assignments ordered
WHERE assignment.id = ordered.id
  AND ordered.next_effective_from IS NOT NULL
  AND (
    assignment.effective_to IS NULL
    OR assignment.effective_to >= ordered.next_effective_from
  );

COMMENT ON COLUMN public.worker_shift_assignments.effective_from IS
  'First local calendar date on which this shift assignment applies.';

COMMENT ON COLUMN public.worker_shift_assignments.effective_to IS
  'Last local calendar date on which this shift assignment applies; historical rows remain queryable.';
