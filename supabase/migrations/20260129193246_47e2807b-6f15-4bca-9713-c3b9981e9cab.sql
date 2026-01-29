-- Add client-level ordering constraints
ALTER TABLE public.clients
ADD COLUMN case_only boolean NOT NULL DEFAULT false,
ADD COLUMN case_size integer NULL;

-- Add constraint: case_size must be positive when set
ALTER TABLE public.clients
ADD CONSTRAINT clients_case_size_positive CHECK (case_size IS NULL OR case_size > 0);

-- Create junction table for client allowed products
CREATE TABLE public.client_allowed_products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id, product_id)
);

-- Enable RLS
ALTER TABLE public.client_allowed_products ENABLE ROW LEVEL SECURITY;

-- RLS policies for client_allowed_products
CREATE POLICY "Admin/Ops can manage client allowed products"
ON public.client_allowed_products
FOR ALL
USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Clients can view their allowed products"
ON public.client_allowed_products
FOR SELECT
USING (client_id = get_user_client_id(auth.uid()));

CREATE POLICY "Deny anonymous access to client_allowed_products"
ON public.client_allowed_products
FOR ALL
USING (false)
WITH CHECK (false);

-- Add comment for documentation
COMMENT ON COLUMN public.clients.case_only IS 'When true, client can only order in case quantities';
COMMENT ON COLUMN public.clients.case_size IS 'Number of units per case when case_only is true';
COMMENT ON TABLE public.client_allowed_products IS 'Junction table restricting which products a client can order. If no rows exist for a client, they can order all active products.';