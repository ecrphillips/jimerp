-- Create roast_group_inventory_levels table for WIP + FG tracking
CREATE TABLE public.roast_group_inventory_levels (
  roast_group text PRIMARY KEY REFERENCES public.roast_groups(roast_group) ON DELETE CASCADE,
  wip_kg numeric NOT NULL DEFAULT 0,
  fg_kg numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.roast_group_inventory_levels ENABLE ROW LEVEL SECURITY;

-- Create policy for Admin/Ops
CREATE POLICY "Admin/Ops can manage roast group inventory levels"
ON public.roast_group_inventory_levels
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Add a comment
COMMENT ON TABLE public.roast_group_inventory_levels IS 'Tracks WIP (unpacked roasted coffee) and FG (finished goods) inventory levels per roast group for production planning';

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_roast_group_inventory_levels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_roast_group_inventory_levels_updated_at
BEFORE UPDATE ON public.roast_group_inventory_levels
FOR EACH ROW
EXECUTE FUNCTION public.update_roast_group_inventory_levels_updated_at();