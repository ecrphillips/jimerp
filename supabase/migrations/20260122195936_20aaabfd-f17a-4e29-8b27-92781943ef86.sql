-- Create roast_groups table
CREATE TABLE public.roast_groups (
  roast_group text PRIMARY KEY,
  standard_batch_kg numeric NOT NULL DEFAULT 20,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.roast_groups ENABLE ROW LEVEL SECURITY;

-- Admin/Ops can manage roast groups
CREATE POLICY "Admin/Ops can manage roast groups"
  ON public.roast_groups
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_roast_groups_updated_at
  BEFORE UPDATE ON public.roast_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Backfill roast_groups from existing products.roast_group values
INSERT INTO public.roast_groups (roast_group, standard_batch_kg)
SELECT DISTINCT roast_group, 20
FROM public.products
WHERE roast_group IS NOT NULL
ON CONFLICT (roast_group) DO NOTHING;