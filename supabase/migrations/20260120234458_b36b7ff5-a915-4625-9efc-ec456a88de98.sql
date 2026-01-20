-- Create source enum for Andon boards
CREATE TYPE public.board_source AS ENUM ('MATCHSTICK', 'FUNK');

-- Table for tracking which products appear on each board
CREATE TABLE public.source_board_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source board_source NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(source, product_id)
);

-- Enable RLS
ALTER TABLE public.source_board_products ENABLE ROW LEVEL SECURITY;

-- Policies for source_board_products
CREATE POLICY "Admin/Ops can manage board products"
ON public.source_board_products FOR ALL
USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Table for production checkmarks (run sheet persistence)
CREATE TABLE public.production_checkmarks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_date DATE NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  bag_size_g INTEGER NOT NULL,
  roast_complete BOOLEAN NOT NULL DEFAULT false,
  pack_complete BOOLEAN NOT NULL DEFAULT false,
  ship_complete BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(target_date, product_id, bag_size_g)
);

-- Enable RLS
ALTER TABLE public.production_checkmarks ENABLE ROW LEVEL SECURITY;

-- Policies for production_checkmarks
CREATE POLICY "Admin/Ops can manage production checkmarks"
ON public.production_checkmarks FOR ALL
USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Table for external demand (Andon board quantities)
CREATE TABLE public.external_demand (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source board_source NOT NULL,
  target_date DATE NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_units INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(source, target_date, product_id)
);

-- Enable RLS
ALTER TABLE public.external_demand ENABLE ROW LEVEL SECURITY;

-- Policies for external_demand
CREATE POLICY "Admin/Ops can manage external demand"
ON public.external_demand FOR ALL
USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

-- Add updated_at triggers
CREATE TRIGGER update_source_board_products_updated_at
BEFORE UPDATE ON public.source_board_products
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_production_checkmarks_updated_at
BEFORE UPDATE ON public.production_checkmarks
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_external_demand_updated_at
BEFORE UPDATE ON public.external_demand
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();