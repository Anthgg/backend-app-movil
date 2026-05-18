-- Migration: 202605180001_create_report_templates.sql
-- Description: Create report_templates table for custom report configurations.

CREATE TABLE IF NOT EXISTS public.report_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  module VARCHAR(50) NOT NULL,
  report_type VARCHAR(50) NOT NULL,
  filters JSONB NOT NULL,
  columns JSONB NOT NULL,
  chart_config JSONB,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for quick lookup
CREATE INDEX IF NOT EXISTS idx_report_templates_company ON public.report_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_user ON public.report_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_module ON public.report_templates(module);

-- Enable RLS
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

-- Allow select/insert/update/delete by company context
CREATE POLICY "report_templates select by company" ON public.report_templates
    FOR SELECT USING (company_id = current_company_id());

CREATE POLICY "report_templates insert by company" ON public.report_templates
    FOR INSERT WITH CHECK (company_id = current_company_id());

CREATE POLICY "report_templates update by company" ON public.report_templates
    FOR UPDATE USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());

CREATE POLICY "report_templates delete by company" ON public.report_templates
    FOR DELETE USING (company_id = current_company_id());
