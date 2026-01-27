-- =============================================
-- CLIENT LOCATIONS FEATURE
-- =============================================

-- 1) Create client_locations table
CREATE TABLE public.client_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure unique location codes per client
  CONSTRAINT client_locations_client_code_unique UNIQUE (client_id, location_code),
  -- Ensure location_code is uppercase letters only
  CONSTRAINT client_locations_code_format CHECK (location_code ~ '^[A-Z]+$')
);

-- Enable RLS
ALTER TABLE public.client_locations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for client_locations
CREATE POLICY "Admin/Ops can manage client locations"
  ON public.client_locations
  FOR ALL
  USING (has_role(auth.uid(), 'ADMIN') OR has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can view their own locations"
  ON public.client_locations
  FOR SELECT
  USING (client_id = get_user_client_id(auth.uid()));

-- Add updated_at trigger
CREATE TRIGGER update_client_locations_updated_at
  BEFORE UPDATE ON public.client_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Index for faster lookups
CREATE INDEX idx_client_locations_client_id ON public.client_locations(client_id);

-- 2) Add location_id to orders table
ALTER TABLE public.orders
  ADD COLUMN location_id UUID REFERENCES public.client_locations(id);

-- Index for location-based queries
CREATE INDEX idx_orders_location_id ON public.orders(location_id);

-- 3) Update order number generation trigger to include location code
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  client_code_val TEXT;
  location_code_val TEXT;
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    -- Get the client_code for this order's client
    SELECT client_code INTO client_code_val FROM public.clients WHERE id = NEW.client_id;
    
    -- If no client_code found (shouldn't happen), use 'ORD' as fallback
    IF client_code_val IS NULL THEN
      client_code_val := 'ORD';
    END IF;
    
    -- Get location_code if location_id is set
    IF NEW.location_id IS NOT NULL THEN
      SELECT location_code INTO location_code_val FROM public.client_locations WHERE id = NEW.location_id;
    END IF;
    
    -- If no location, use 'XX' as fallback
    IF location_code_val IS NULL THEN
      location_code_val := 'XX';
    END IF;
    
    -- Format: CLIENTCODELOCATIONCODE-000123
    NEW.order_number := client_code_val || location_code_val || '-' || LPAD(nextval('public.order_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) Seed Oldhand locations
INSERT INTO public.client_locations (client_id, name, location_code)
SELECT id, 'Langley', 'LY'
FROM public.clients
WHERE client_code = 'OLD'
ON CONFLICT (client_id, location_code) DO NOTHING;

INSERT INTO public.client_locations (client_id, name, location_code)
SELECT id, 'Abbotsford', 'AB'
FROM public.clients
WHERE client_code = 'OLD'
ON CONFLICT (client_id, location_code) DO NOTHING;