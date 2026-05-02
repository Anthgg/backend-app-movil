-- Migración: 202605020020_fix_missing_rls.sql
-- Propósito: Corrección de tablas faltantes de RLS, adición de company_id y políticas.

DO $$
BEGIN
  -- Agregar company_id a tablas que lo requieren para RLS eficiente (Denormalización controlada)
  IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'attendance_evidence' AND column_name = 'company_id') THEN
    ALTER TABLE public.attendance_evidence ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'company_id') THEN
    ALTER TABLE public.notifications ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'payroll_record_items' AND column_name = 'company_id') THEN
    ALTER TABLE public.payroll_record_items ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'user_devices' AND column_name = 'company_id') THEN
    ALTER TABLE public.user_devices ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'worker_shifts' AND column_name = 'company_id') THEN
    ALTER TABLE public.worker_shifts ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Habilitar RLS en las tablas faltantes
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'approval_flows', 'approval_steps', 'attendance_evidence', 'backup_logs', 'companies', 
    'company_calendar', 'company_settings', 'contract_documents', 'contract_types', 
    'deleted_records_audit', 'document_acceptances', 'document_versions', 'generated_reports', 
    'job_runs', 'leave_balances', 'medical_leaves', 'notifications', 'overtime_records', 
    'payroll_adjustments', 'payroll_concepts', 'payroll_record_items', 'payroll_settings', 
    'request_approvals', 'shifts', 'user_devices', 'user_status_history', 'vacations', 
    'worker_contracts', 'worker_shifts', 'worker_status_history'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- Políticas para tablas que acabamos de agregarles company_id + las que ya tenían pero no tenían RLS
DO $$ 
DECLARE
  t text;
  tables text[] := ARRAY[
    'approval_flows', 'attendance_evidence', 'company_calendar', 'company_settings', 
    'contract_types', 'document_versions', 'generated_reports', 'job_runs', 
    'leave_balances', 'medical_leaves', 'notifications', 'payroll_adjustments', 
    'payroll_concepts', 'payroll_record_items', 'payroll_settings', 'shifts', 
    'user_devices', 'vacations', 'worker_shifts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = t) AND
       EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'company_id') THEN
       
      BEGIN
        EXECUTE format('CREATE POLICY "%s select by company" ON public.%I FOR SELECT USING (company_id = current_company_id());', t, t);
      EXCEPTION WHEN duplicate_object THEN NULL; END;
      
      BEGIN
        EXECUTE format('CREATE POLICY "%s insert by company" ON public.%I FOR INSERT WITH CHECK (company_id = current_company_id());', t, t);
      EXCEPTION WHEN duplicate_object THEN NULL; END;

      BEGIN
        EXECUTE format('CREATE POLICY "%s update by company" ON public.%I FOR UPDATE USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());', t, t);
      EXCEPTION WHEN duplicate_object THEN NULL; END;

      BEGIN
        EXECUTE format('CREATE POLICY "%s delete by company" ON public.%I FOR DELETE USING (company_id = current_company_id());', t, t);
      EXCEPTION WHEN duplicate_object THEN NULL; END;

    END IF;
  END LOOP;
END $$;

-- Arreglar tablas que tenían RLS pero sin policies
DO $$
BEGIN
  -- audit_logs
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'company_id') THEN
    BEGIN EXECUTE 'CREATE POLICY "audit_logs select by company" ON public.audit_logs FOR SELECT USING (company_id = current_company_id());'; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN EXECUTE 'CREATE POLICY "audit_logs insert by company" ON public.audit_logs FOR INSERT WITH CHECK (company_id = current_company_id());'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;

  -- role_permissions
  -- role_permissions no suele tener company_id porque hereda del rol, si no tiene, usamos la relación.
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'role_permissions') AND NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'role_permissions' AND column_name = 'company_id') THEN
    BEGIN EXECUTE 'CREATE POLICY "role_permissions select" ON public.role_permissions FOR SELECT USING (true);'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;

  -- companies table (solo SELECT a la suya)
  BEGIN EXECUTE 'CREATE POLICY "companies select by id" ON public.companies FOR SELECT USING (id = current_company_id());'; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
