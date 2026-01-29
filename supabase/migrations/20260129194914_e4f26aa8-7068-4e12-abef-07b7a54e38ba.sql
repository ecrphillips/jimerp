-- Create the updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create packaging_types table (admin-managed, not enum)
CREATE TABLE public.packaging_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.packaging_types ENABLE ROW LEVEL SECURITY;

-- Admin/Ops can manage packaging types
CREATE POLICY "Admin/Ops can manage packaging types"
  ON public.packaging_types
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- Deny anonymous access
CREATE POLICY "Deny anonymous access to packaging_types"
  ON public.packaging_types
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Add updated_at trigger
CREATE TRIGGER update_packaging_types_updated_at
  BEFORE UPDATE ON public.packaging_types
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial packaging types
INSERT INTO public.packaging_types (name, display_order) VALUES
  ('Retail Bag', 1),
  ('Mini Can', 2),
  ('Crowler Can', 3),
  ('Bulk Bag', 4),
  ('Bulk Other', 5);

-- Add packaging_type_id and grams_per_unit columns to products table
ALTER TABLE public.products
  ADD COLUMN packaging_type_id UUID REFERENCES public.packaging_types(id),
  ADD COLUMN grams_per_unit INTEGER;

-- Comment for clarity
COMMENT ON COLUMN public.products.grams_per_unit IS 'Authoritative gram weight per unit. Source of truth for bag size.';