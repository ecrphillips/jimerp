
CREATE TABLE public.coroast_availability_windows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  day_of_week TEXT NOT NULL,
  open_time TIME WITHOUT TIME ZONE NOT NULL,
  close_time TIME WITHOUT TIME ZONE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.coroast_availability_windows ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Authenticated users can view availability windows"
ON public.coroast_availability_windows
FOR SELECT
TO authenticated
USING (true);

-- Admin/Ops can manage
CREATE POLICY "Admin/Ops can insert availability windows"
ON public.coroast_availability_windows
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin/Ops can update availability windows"
ON public.coroast_availability_windows
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin/Ops can delete availability windows"
ON public.coroast_availability_windows
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Deny anon
CREATE POLICY "Deny anon coroast_availability_windows"
ON public.coroast_availability_windows
FOR ALL
TO anon
USING (false)
WITH CHECK (false);
