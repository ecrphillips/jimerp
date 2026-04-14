
CREATE TABLE public.coroast_billing_extras (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  billing_period_id UUID NOT NULL REFERENCES public.coroast_billing_periods(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL,
  apply_gst BOOLEAN NOT NULL DEFAULT true,
  apply_pst BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coroast_billing_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can view extras"
  ON public.coroast_billing_extras FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Internal users can insert extras"
  ON public.coroast_billing_extras FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Internal users can delete extras"
  ON public.coroast_billing_extras FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE TRIGGER update_coroast_billing_extras_updated_at
  BEFORE UPDATE ON public.coroast_billing_extras
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
