-- Create app_settings table for admin-configurable settings
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- ADMIN can read/write
CREATE POLICY "Admin can manage app settings"
  ON public.app_settings
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role));

-- OPS can read
CREATE POLICY "Ops can read app settings"
  ON public.app_settings
  FOR SELECT
  USING (has_role(auth.uid(), 'OPS'::app_role));

-- Seed the order notification setting
INSERT INTO public.app_settings (key, value_json)
VALUES ('order_submit_notification', '{"enabled": true, "emails": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Add notification tracking columns to orders table
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS notify_email_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS notify_email_error TEXT NULL;