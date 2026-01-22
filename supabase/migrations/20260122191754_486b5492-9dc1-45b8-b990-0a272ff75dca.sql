-- Add roast_group column to products
ALTER TABLE public.products ADD COLUMN roast_group text;

-- Create roasted_batches_status enum
CREATE TYPE roasted_batch_status AS ENUM ('PLANNED', 'ROASTED');

-- Create roasted_batches table for tracking roast batches and inventory
CREATE TABLE public.roasted_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  roast_group text NOT NULL,
  target_date date NOT NULL,
  planned_output_kg numeric,
  actual_output_kg numeric NOT NULL DEFAULT 0,
  status roasted_batch_status NOT NULL DEFAULT 'PLANNED',
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS on roasted_batches
ALTER TABLE public.roasted_batches ENABLE ROW LEVEL SECURITY;

-- RLS policy: Admin/Ops can manage roasted_batches
CREATE POLICY "Admin/Ops can manage roasted batches"
ON public.roasted_batches
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_roasted_batches_updated_at
  BEFORE UPDATE ON public.roasted_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Create packing_runs table for tracking packing progress
CREATE TABLE public.packing_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id),
  target_date date NOT NULL,
  units_packed integer NOT NULL DEFAULT 0,
  kg_consumed numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE(product_id, target_date)
);

-- Enable RLS on packing_runs
ALTER TABLE public.packing_runs ENABLE ROW LEVEL SECURITY;

-- RLS policy: Admin/Ops can manage packing_runs
CREATE POLICY "Admin/Ops can manage packing runs"
ON public.packing_runs
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_packing_runs_updated_at
  BEFORE UPDATE ON public.packing_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();