-- Enable RLS on sensitive tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Creating basic policies (can be improved based on roles later)

-- USERS: Can see their own data
CREATE POLICY "Users can view own data" 
ON public.users FOR SELECT 
USING (auth.uid() = id);

-- WORKERS: Can see their own profile
CREATE POLICY "Workers can view own profile" 
ON public.workers FOR SELECT 
USING (user_id = auth.uid());

-- ATTENDANCE: Workers can see their own attendance
CREATE POLICY "Workers can view own attendance" 
ON public.attendance_records FOR SELECT 
USING (worker_id IN (SELECT id FROM public.workers WHERE user_id = auth.uid()));

-- REQUESTS: Workers can view their own requests
CREATE POLICY "Workers can view own requests" 
ON public.employee_requests FOR SELECT 
USING (worker_id IN (SELECT id FROM public.workers WHERE user_id = auth.uid()));

-- DOCUMENTS: Workers can view their own documents
CREATE POLICY "Workers can view own documents" 
ON public.documents FOR SELECT 
USING (worker_id IN (SELECT id FROM public.workers WHERE user_id = auth.uid()));

-- Note: Admin/HR bypass these policies via backend connection using Service Role or specialized RLS functions.
-- Since this backend uses a connection string with postgres user, RLS is bypassed by default for backend queries. 
-- RLS here is mostly for direct Supabase Client access if used from frontend.
