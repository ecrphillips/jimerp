-- Create roast_group_components table for blend recipes
CREATE TABLE public.roast_group_components (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_roast_group TEXT NOT NULL REFERENCES public.roast_groups(roast_group) ON DELETE CASCADE,
  component_roast_group TEXT NOT NULL REFERENCES public.roast_groups(roast_group) ON DELETE RESTRICT,
  pct NUMERIC NOT NULL CHECK (pct > 0 AND pct <= 100),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(parent_roast_group, component_roast_group)
);

-- Enable RLS
ALTER TABLE public.roast_group_components ENABLE ROW LEVEL SECURITY;

-- RLS policy: Admin/Ops can manage roast group components
CREATE POLICY "Admin/Ops can manage roast group components"
ON public.roast_group_components
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Add planned_for_blend_roast_group column to roasted_batches for blend lineage tracking
ALTER TABLE public.roasted_batches 
ADD COLUMN planned_for_blend_roast_group TEXT REFERENCES public.roast_groups(roast_group) ON DELETE SET NULL;

-- Create index for efficient blend component lookups
CREATE INDEX idx_roast_group_components_parent ON public.roast_group_components(parent_roast_group);
CREATE INDEX idx_roasted_batches_blend_parent ON public.roasted_batches(planned_for_blend_roast_group) WHERE planned_for_blend_roast_group IS NOT NULL;