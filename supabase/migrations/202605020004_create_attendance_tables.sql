-- ATTENDANCE RECORDS
CREATE TABLE public.attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES public.workers(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_in_latitude DOUBLE PRECISION,
    check_in_longitude DOUBLE PRECISION,
    check_out_time TIMESTAMP WITH TIME ZONE,
    check_out_latitude DOUBLE PRECISION,
    check_out_longitude DOUBLE PRECISION,
    status VARCHAR(20) DEFAULT 'PRESENT', -- PRESENT, LATE, ABSENT
    hours_worked NUMERIC(5, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(worker_id, date) -- Evitar doble entrada el mismo día
);

-- ATTENDANCE PHOTOS
CREATE TABLE public.attendance_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    photo_type VARCHAR(20) NOT NULL, -- CHECK_IN, CHECK_OUT
    photo_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ATTENDANCE CORRECTIONS
CREATE TABLE public.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendance_record_id UUID REFERENCES public.attendance_records(id) ON DELETE CASCADE,
    corrected_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    old_check_in TIMESTAMP WITH TIME ZONE,
    new_check_in TIMESTAMP WITH TIME ZONE,
    old_check_out TIMESTAMP WITH TIME ZONE,
    new_check_out TIMESTAMP WITH TIME ZONE,
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER update_attendance_modtime BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
