-- A) Create wip_adjustments table for manual WIP adjustments
CREATE TYPE public.wip_adjustment_reason AS ENUM ('LOSS', 'COUNT_ADJUSTMENT', 'CONTAMINATION', 'OTHER');

CREATE TABLE public.wip_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roast_group TEXT NOT NULL,
  kg_delta NUMERIC NOT NULL,
  reason wip_adjustment_reason NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.wip_adjustments ENABLE ROW LEVEL SECURITY;

-- Admin/Ops can manage wip_adjustments
CREATE POLICY "Admin/Ops can manage wip adjustments"
ON public.wip_adjustments
FOR ALL
USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Create fg_inventory table for finished goods tracking
CREATE TABLE public.fg_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  units_on_hand INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(product_id)
);

-- Enable RLS
ALTER TABLE public.fg_inventory ENABLE ROW LEVEL SECURITY;

-- Admin/Ops can manage fg_inventory
CREATE POLICY "Admin/Ops can manage fg inventory"
ON public.fg_inventory
FOR ALL
USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Create fg_inventory_log for tracking changes
CREATE TABLE public.fg_inventory_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  units_delta INTEGER NOT NULL,
  units_after INTEGER NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.fg_inventory_log ENABLE ROW LEVEL SECURITY;

-- Admin/Ops can manage fg_inventory_log
CREATE POLICY "Admin/Ops can manage fg inventory log"
ON public.fg_inventory_log
FOR ALL
USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));