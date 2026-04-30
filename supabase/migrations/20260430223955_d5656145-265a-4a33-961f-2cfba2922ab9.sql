DROP TABLE IF EXISTS public.packaging_costs CASCADE;

CREATE TABLE public.packaging_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packaging_variant packaging_variant NOT NULL UNIQUE,
  cost_per_unit NUMERIC NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.packaging_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny anon packaging_costs"
  ON public.packaging_costs
  AS PERMISSIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Admin/Ops can read packaging_costs"
  ON public.packaging_costs
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin can manage packaging_costs"
  ON public.packaging_costs
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

CREATE TRIGGER update_packaging_costs_updated_at
  BEFORE UPDATE ON public.packaging_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();