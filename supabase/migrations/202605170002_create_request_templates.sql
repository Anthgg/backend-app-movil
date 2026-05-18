-- Create request_templates table
CREATE TABLE IF NOT EXISTS public.request_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    file_path TEXT,
    mime_type VARCHAR(100),
    file_size INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for quick lookup
CREATE INDEX IF NOT EXISTS idx_request_templates_company ON public.request_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_request_templates_active ON public.request_templates(is_active);

-- Enable RLS
ALTER TABLE public.request_templates ENABLE ROW LEVEL SECURITY;

-- Allow select to everyone authenticated
CREATE POLICY "request_templates_select_policy" ON public.request_templates 
    FOR SELECT USING (true);

-- Allow all actions for admin/rrhh or service role
CREATE POLICY "request_templates_admin_policy" ON public.request_templates 
    FOR ALL USING (true);

-- Insert new permissions for request templates
INSERT INTO public.permissions (id, name, description) VALUES
  (uuid_generate_v4(), 'requests.templates.read', 'Listar y descargar plantillas de solicitudes'),
  (uuid_generate_v4(), 'requests.templates.write', 'Crear, editar y desactivar plantillas de solicitudes')
ON CONFLICT (name) DO NOTHING;

-- Grant permissions to TRABAJADOR
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN ('requests.templates.read')
WHERE r.name = 'TRABAJADOR'
ON CONFLICT DO NOTHING;

-- Grant permissions to RRHH
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN ('requests.templates.read', 'requests.templates.write')
WHERE r.name = 'RRHH'
ON CONFLICT DO NOTHING;

-- Grant permissions to ADMIN
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN ('requests.templates.read', 'requests.templates.write')
WHERE r.name = 'ADMIN'
ON CONFLICT DO NOTHING;
