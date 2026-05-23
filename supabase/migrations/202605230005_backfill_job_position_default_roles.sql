-- Ensure existing company job positions can suggest a role in worker onboarding.
UPDATE public.job_positions position
SET default_role_id = role.id,
    updated_at = NOW()
FROM public.roles role
WHERE position.deleted_at IS NULL
  AND position.default_role_id IS NULL
  AND role.deleted_at IS NULL
  AND COALESCE(role.is_active, TRUE) = TRUE
  AND UPPER(COALESCE(role.code, role.name)) = 'TRABAJADOR'
  AND (role.company_id = position.company_id OR role.company_id IS NULL);
