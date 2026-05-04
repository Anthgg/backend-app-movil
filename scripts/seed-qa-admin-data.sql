-- ============================================
-- SEED DATA FOR QA ADMIN USER
-- Email: admin.qa@demo.com
-- Propósito: Datos realistas para pruebas en la app móvil
-- ============================================

DO $$
DECLARE
    v_user_id UUID;
    v_department_id UUID;
    v_job_position_id UUID;
    v_worker_id UUID;
    v_project_id UUID;
    v_schedule_id UUID;
    v_minutes INTEGER;
    v_check_in_time TIMESTAMP WITH TIME ZONE;
    v_check_out_time TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Obtener el usuario QA
    SELECT id INTO v_user_id FROM public.users WHERE email = 'admin.qa@demo.com';
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuario admin.qa@demo.com no encontrado';
    END IF;
    
    RAISE NOTICE 'Usuario QA ID: %', v_user_id;
    
    -- ================================================
    -- 2. CREAR DEPARTAMENTO
    -- ================================================
    INSERT INTO public.departments (name, description)
    VALUES ('Ingeniería de Sistemas', 'Departamento de IT y Desarrollo')
    ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
    RETURNING id INTO v_department_id;
    
    RAISE NOTICE 'Departamento ID: %', v_department_id;
    
    -- ================================================
    -- 3. CREAR POSICIÓN DE TRABAJO
    -- ================================================
    INSERT INTO public.job_positions (title, department_id, base_salary)
    VALUES ('Senior Developer', v_department_id, 5000.00)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_job_position_id;
    
    IF v_job_position_id IS NULL THEN
        SELECT id INTO v_job_position_id 
        FROM public.job_positions 
        WHERE title = 'Senior Developer' AND department_id = v_department_id
        LIMIT 1;
    END IF;
    
    RAISE NOTICE 'Posición ID: %', v_job_position_id;
    
    -- ================================================
    -- 4. CREAR O ACTUALIZAR WORKER
    -- ================================================
    INSERT INTO public.workers (
        user_id, 
        document_type, 
        document_number, 
        phone_number, 
        address, 
        job_position_id, 
        hire_date, 
        status,
        profile_photo_url
    ) VALUES (
        v_user_id,
        'DNI',
        '12345678',
        '+34 666 777 888',
        'Calle Principal 123, Madrid, España',
        v_job_position_id,
        CURRENT_DATE - INTERVAL '2 years',
        'ACTIVE',
        'https://api.example.com/photos/admin-qa.jpg'
    )
    ON CONFLICT (user_id) DO UPDATE SET
        phone_number = EXCLUDED.phone_number,
        address = EXCLUDED.address,
        job_position_id = EXCLUDED.job_position_id,
        status = EXCLUDED.status
    RETURNING id INTO v_worker_id;
    
    RAISE NOTICE 'Worker ID: %', v_worker_id;
    
    -- ================================================
    -- 5. CREAR PROYECTOS / WORK SITES
    -- ================================================
    INSERT INTO public.projects (name, address, latitude, longitude, allowed_radius_meters, is_active)
    VALUES 
        ('Oficina Central Madrid', 'Calle Principal 456, Madrid', 40.4168, -3.7038, 100, TRUE),
        ('Proyecto Tech Hub Barcelona', 'Avenida Diagonal 789, Barcelona', 41.3874, 2.1686, 150, TRUE),
        ('Oficina Remota QA', 'Home Office', 40.4200, -3.7050, 500, TRUE)
    ON CONFLICT DO NOTHING;
    
    SELECT id INTO v_project_id FROM public.projects WHERE name = 'Oficina Central Madrid' LIMIT 1;
    RAISE NOTICE 'Proyecto Principal ID: %', v_project_id;
    
    -- ================================================
    -- 6. ASIGNAR WORKER A PROYECTOS
    -- ================================================
    INSERT INTO public.project_assignments (worker_id, project_id, assigned_at)
    SELECT v_worker_id, id, CURRENT_TIMESTAMP
    FROM public.projects
    WHERE name IN ('Oficina Central Madrid', 'Proyecto Tech Hub Barcelona', 'Oficina Remota QA')
    ON CONFLICT (worker_id, project_id) DO NOTHING;
    
    RAISE NOTICE 'Worker asignado a 3 proyectos';
    
    -- ================================================
    -- 7. CREAR HORARIOS DE TRABAJO
    -- ================================================
    INSERT INTO public.work_schedules (name, start_time, end_time, tolerance_minutes)
    VALUES 
        ('Horario Diurno Standard', '08:00:00', '17:00:00', 15),
        ('Horario Flexible', '07:00:00', '18:00:00', 30),
        ('Turno Tarde', '14:00:00', '23:00:00', 15)
    ON CONFLICT DO NOTHING;
    
    SELECT id INTO v_schedule_id FROM public.work_schedules WHERE name = 'Horario Diurno Standard' LIMIT 1;
    RAISE NOTICE 'Schedule ID: %', v_schedule_id;
    
    -- ================================================
    -- 8. CREAR REGISTROS DE ASISTENCIA
    -- ================================================
    FOR i IN 0..14 LOOP
        -- Calcular minutos variados
        v_minutes := ((i * 3) % 60);
        
        -- Calcular check-in y check-out
        v_check_in_time := (CURRENT_DATE - (i || ' days')::INTERVAL)::TIMESTAMP + INTERVAL '8 hours' + (v_minutes || ' minutes')::INTERVAL;
        v_check_out_time := (CURRENT_DATE - (i || ' days')::INTERVAL)::TIMESTAMP + INTERVAL '17 hours' + (v_minutes || ' minutes')::INTERVAL;
        
        INSERT INTO public.attendance_records (
            worker_id,
            project_id,
            date,
            check_in_time,
            check_in_latitude,
            check_in_longitude,
            check_out_time,
            check_out_latitude,
            check_out_longitude,
            status,
            hours_worked
        ) VALUES (
            v_worker_id,
            v_project_id,
            CURRENT_DATE - (i || ' days')::INTERVAL,
            v_check_in_time,
            40.4168 + (RANDOM() * 0.001),
            -3.7038 + (RANDOM() * 0.001),
            v_check_out_time,
            40.4168 + (RANDOM() * 0.001),
            -3.7038 + (RANDOM() * 0.001),
                CASE 
                    WHEN RANDOM() < 0.1 THEN 'late'
                    WHEN RANDOM() < 0.05 THEN 'absent'
                    ELSE 'present'
                END,
            8 + (RANDOM() * 1)
        )
        ON CONFLICT (worker_id, date) DO NOTHING;
    END LOOP;
    
    RAISE NOTICE 'Registros de asistencia creados (últimos 15 días)';
    
    -- ================================================
    -- 9. CREAR FOTOS DE ASISTENCIA
    -- ================================================
    INSERT INTO public.attendance_photos (attendance_record_id, photo_type, photo_url)
    SELECT 
        ar.id,
        'CHECK_IN',
        'https://api.example.com/photos/checkin-' || ar.id || '.jpg'
    FROM public.attendance_records ar
    WHERE ar.worker_id = v_worker_id
    ON CONFLICT DO NOTHING;
    
    INSERT INTO public.attendance_photos (attendance_record_id, photo_type, photo_url)
    SELECT 
        ar.id,
        'CHECK_OUT',
        'https://api.example.com/photos/checkout-' || ar.id || '.jpg'
    FROM public.attendance_records ar
    WHERE ar.worker_id = v_worker_id
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Fotos de asistencia creadas';
    
    -- ================================================
    -- SUMMARY
    -- ================================================
    RAISE NOTICE '✅ ============================================';
    RAISE NOTICE '✅ SEED DATA COMPLETADO PARA QA ADMIN';
    RAISE NOTICE '✅ ============================================';
    RAISE NOTICE 'Usuario: admin.qa@demo.com (ID: %)', v_user_id;
    RAISE NOTICE 'Worker: Documento 12345678 (ID: %)', v_worker_id;
    RAISE NOTICE 'Departamento: Ingeniería de Sistemas';
    RAISE NOTICE 'Posición: Senior Developer - $5000';
    RAISE NOTICE 'Proyectos: 3 asignados';
    RAISE NOTICE 'Registros de Asistencia: 15 días';
    RAISE NOTICE 'Fotos: 30 (check-in/out)';
    RAISE NOTICE '✅ ============================================';
    
END $$;
