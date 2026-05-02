-- Migración: 202605020019_add_database_restrictions_rls.sql
-- Propósito: Asegurar RLS, FKs, Unique Constraints, Check Constraints en base de datos multiempresa.

-- 1. Función para obtener el company_id de la sesión actual
CREATE OR REPLACE FUNCTION current_company_id() RETURNS uuid AS $$
BEGIN
  -- Intento 1: Supabase PostgREST JWT claims
  IF current_setting('request.jwt.claims', true) IS NOT NULL THEN
    RETURN (current_setting('request.jwt.claims', true)::json->>'company_id')::uuid;
  END IF;
  
  -- Intento 2: Backend Node.js custom session variable (app.current_company_id)
  RETURN current_setting('app.current_company_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Habilitar RLS en todas las tablas sensibles
DO $$ 
DECLARE
  t text;
  tables text[] := ARRAY[
    'companies', 'users', 'roles', 'permissions', 'role_permissions', 'user_roles', 
    'workers', 'job_positions', 'departments', 'projects', 'project_assignments', 
    'work_schedules', 'shifts', 'worker_shifts', 'attendance_records', 'attendance_evidence', 
    'attendance_corrections', 'employee_requests', 'request_types', 'request_documents', 
    'vacations', 'leave_balances', 'medical_leaves', 'documents', 'document_types', 
    'payroll_periods', 'payroll_records', 'payroll_concepts', 'payroll_record_items', 
    'payroll_adjustments', 'generated_reports', 'job_runs', 'audit_logs', 'user_devices', 'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Verificamos que la tabla exista antes de aplicar RLS
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- 3. Crear políticas RLS por cada tabla multiempresa
DO $$ 
DECLARE
  t text;
  -- Tablas que tienen company_id
  tables text[] := ARRAY[
    'users', 'roles', 'permissions', 'role_permissions', 'user_roles', 
    'workers', 'job_positions', 'departments', 'projects', 'project_assignments', 
    'work_schedules', 'shifts', 'worker_shifts', 'attendance_records', 'attendance_evidence', 
    'attendance_corrections', 'employee_requests', 'request_types', 'request_documents', 
    'vacations', 'leave_balances', 'medical_leaves', 'documents', 'document_types', 
    'payroll_periods', 'payroll_records', 'payroll_concepts', 'payroll_record_items', 
    'payroll_adjustments', 'generated_reports', 'job_runs', 'audit_logs', 'user_devices', 'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = t) AND
       EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'company_id') THEN
       
      -- Evitar duplicados (Ignorar excepciones si ya existe)
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

-- Política para la tabla de companies (solo el superadmin o usuarios de esa empresa)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies') THEN
    BEGIN
      EXECUTE 'CREATE POLICY "companies select by id" ON public.companies FOR SELECT USING (id = current_company_id());';
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- 4. Añadir Claves Foráneas Faltantes (Verificando antes si no existen)
DO $$ 
BEGIN
  -- Helper dinámico para no fallar si ya existen
  -- users.company_id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_company_id') THEN
    ALTER TABLE public.users ADD CONSTRAINT fk_users_company_id FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  -- workers.company_id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workers_company_id') THEN
    ALTER TABLE public.workers ADD CONSTRAINT fk_workers_company_id FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  -- workers.user_id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workers_user_id') THEN
    ALTER TABLE public.workers ADD CONSTRAINT fk_workers_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  -- workers.job_position_id
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'job_positions') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workers_job_position_id') THEN
    ALTER TABLE public.workers ADD CONSTRAINT fk_workers_job_position_id FOREIGN KEY (job_position_id) REFERENCES public.job_positions(id) ON DELETE SET NULL;
  END IF;

  -- workers.department_id
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'departments') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workers_department_id') THEN
    ALTER TABLE public.workers ADD CONSTRAINT fk_workers_department_id FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;

  -- workers.project_id
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'projects') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workers_project_id') THEN
    ALTER TABLE public.workers ADD CONSTRAINT fk_workers_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;

  -- attendance_records.company_id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_records_company_id') THEN
    ALTER TABLE public.attendance_records ADD CONSTRAINT fk_attendance_records_company_id FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;

  -- attendance_records.worker_id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_records_worker_id') THEN
    ALTER TABLE public.attendance_records ADD CONSTRAINT fk_attendance_records_worker_id FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
  END IF;

  -- employee_requests
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'employee_requests') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_employee_requests_company_id') THEN
      ALTER TABLE public.employee_requests ADD CONSTRAINT fk_employee_requests_company_id FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_employee_requests_worker_id') THEN
      ALTER TABLE public.employee_requests ADD CONSTRAINT fk_employee_requests_worker_id FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
    END IF;
  END IF;

  -- payroll_periods
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payroll_periods') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payroll_periods_company_id') THEN
      ALTER TABLE public.payroll_periods ADD CONSTRAINT fk_payroll_periods_company_id FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
    END IF;
  END IF;

  -- payroll_records
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payroll_records') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payroll_records_company_id') THEN
      ALTER TABLE public.payroll_records ADD CONSTRAINT fk_payroll_records_company_id FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payroll_records_worker_id') THEN
      ALTER TABLE public.payroll_records ADD CONSTRAINT fk_payroll_records_worker_id FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payroll_records_payroll_period_id') THEN
      ALTER TABLE public.payroll_records ADD CONSTRAINT fk_payroll_records_payroll_period_id FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id) ON DELETE CASCADE;
    END IF;
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Capturar y notificar pero no fallar toda la migración
  RAISE WARNING 'Ocurrió un error al crear las llaves foráneas: %', SQLERRM;
END $$;

-- 5. Crear Índices Únicos (Limpiando duplicados lógicos primero si fuera necesario o ignorando error)
DO $$ 
BEGIN
  -- workers: UNIQUE(company_id, document_number) WHERE deleted_at IS NULL
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_workers_unique_doc') THEN
    CREATE UNIQUE INDEX idx_workers_unique_doc ON public.workers(company_id, document_number) WHERE deleted_at IS NULL;
  END IF;

  -- users: UNIQUE(company_id, email) WHERE deleted_at IS NULL
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_unique_email') THEN
    CREATE UNIQUE INDEX idx_users_unique_email ON public.users(company_id, email) WHERE deleted_at IS NULL;
  END IF;

  -- job_positions: UNIQUE(company_id, name) WHERE deleted_at IS NULL
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'job_positions') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_job_positions_unique_name') THEN
    CREATE UNIQUE INDEX idx_job_positions_unique_name ON public.job_positions(company_id, name) WHERE deleted_at IS NULL;
  END IF;

  -- projects: UNIQUE(company_id, code) WHERE deleted_at IS NULL
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'projects') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_projects_unique_code') THEN
    CREATE UNIQUE INDEX idx_projects_unique_code ON public.projects(company_id, code) WHERE deleted_at IS NULL;
  END IF;

  -- attendance_records: UNIQUE(company_id, worker_id, attendance_date)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_unique_day') THEN
    CREATE UNIQUE INDEX idx_attendance_unique_day ON public.attendance_records(company_id, worker_id, attendance_date);
  END IF;

  -- payroll_periods: UNIQUE(company_id, year, month) WHERE deleted_at IS NULL
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payroll_periods') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_payroll_periods_unique_period') THEN
    CREATE UNIQUE INDEX idx_payroll_periods_unique_period ON public.payroll_periods(company_id, year, month) WHERE deleted_at IS NULL;
  END IF;

EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'Hay duplicados en las tablas. Por favor limpiar registros antes de crear índices únicos.';
WHEN OTHERS THEN
  RAISE WARNING 'Error al crear índices únicos: %', SQLERRM;
END $$;

-- 6. Check constraints (Evitamos error si ya existen usando DO)
DO $$
BEGIN
  -- users.status
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status') THEN
    ALTER TABLE public.users ADD CONSTRAINT chk_users_status CHECK (status IN ('active', 'inactive', 'blocked', 'suspended', 'pending'));
  END IF;

  -- attendance_records.status
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_status') THEN
    ALTER TABLE public.attendance_records ADD CONSTRAINT chk_attendance_status CHECK (status IN ('present', 'late', 'absent', 'incomplete', 'out_of_range', 'observed', 'rejected', 'corrected', 'justified_absence', 'vacation', 'medical_leave', 'leave_permission'));
  END IF;

  -- employee_requests.status
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'employee_requests') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_employee_requests_status') THEN
    ALTER TABLE public.employee_requests ADD CONSTRAINT chk_employee_requests_status CHECK (status IN ('draft', 'pending', 'pending_supervisor', 'pending_rrhh', 'observed', 'approved', 'rejected', 'cancelled', 'expired'));
  END IF;

  -- payroll_periods.status
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payroll_periods') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payroll_periods_status') THEN
    ALTER TABLE public.payroll_periods ADD CONSTRAINT chk_payroll_periods_status CHECK (status IN ('draft', 'generated', 'reviewed', 'approved', 'closed', 'cancelled'));
  END IF;

EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'Hay datos que no cumplen los nuevos check constraints.';
WHEN OTHERS THEN
  RAISE WARNING 'Error al crear check constraints: %', SQLERRM;
END $$;

-- 7. Soft deletes fields verification
-- Comprobamos si las columnas existen, si no las agregamos en tablas principales
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['users', 'workers', 'projects', 'job_positions'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = t AND column_name = 'deleted_at') THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN deleted_at timestamp with time zone;', t);
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = t AND column_name = 'deleted_by') THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN deleted_by uuid;', t);
      END IF;
      IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = t AND column_name = 'delete_reason') THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN delete_reason text;', t);
      END IF;
    END IF;
  END LOOP;
END $$;
