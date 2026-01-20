-- Create role enum
CREATE TYPE public.app_role AS ENUM ('ADMIN', 'OPS', 'CLIENT');

-- Create format enum
CREATE TYPE public.product_format AS ENUM ('WHOLE_BEAN', 'ESPRESSO', 'FILTER', 'OTHER');

-- Create grind options enum  
CREATE TYPE public.grind_option AS ENUM ('WHOLE_BEAN', 'ESPRESSO', 'FILTER');

-- Create order status enum
CREATE TYPE public.order_status AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED');

-- Create delivery method enum
CREATE TYPE public.delivery_method AS ENUM ('PICKUP', 'DELIVERY', 'COURIER');

-- Create production status enum
CREATE TYPE public.production_status AS ENUM ('PLANNED', 'ROASTED', 'PACKED', 'STAGED', 'COMPLETE');

-- Create clients table
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  billing_contact_name TEXT,
  billing_email TEXT,
  shipping_address TEXT,
  notes_internal TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  UNIQUE (user_id, role),
  -- CLIENT role must have client_id, internal roles must not
  CONSTRAINT client_role_requires_client CHECK (
    (role = 'CLIENT' AND client_id IS NOT NULL) OR 
    (role IN ('ADMIN', 'OPS') AND client_id IS NULL)
  )
);

-- Create profiles table for user info
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create products table
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  sku TEXT,
  format product_format NOT NULL DEFAULT 'OTHER',
  bag_size_g INTEGER NOT NULL,
  grind_options grind_option[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  internal_packaging_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create price_list table
CREATE TABLE public.price_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_price DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create green_coffee_lots table
CREATE TABLE public.green_coffee_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  supplier TEXT,
  origin TEXT,
  received_date DATE,
  kg_received DECIMAL(10,2) NOT NULL DEFAULT 0,
  kg_on_hand DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes_internal TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create sequence for order numbers
CREATE SEQUENCE public.order_number_seq START 1;

-- Create orders table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL UNIQUE,
  status order_status NOT NULL DEFAULT 'DRAFT',
  requested_ship_date DATE,
  delivery_method delivery_method NOT NULL DEFAULT 'PICKUP',
  client_po TEXT,
  created_by_user_id UUID REFERENCES auth.users(id),
  internal_ops_notes TEXT,
  client_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create order_line_items table
CREATE TABLE public.order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity_units INTEGER NOT NULL,
  grind grind_option,
  unit_price_locked DECIMAL(10,2) NOT NULL,
  line_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create production_plan_items table
CREATE TABLE public.production_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date DATE NOT NULL,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id),
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity_units INTEGER NOT NULL,
  status production_status NOT NULL DEFAULT 'PLANNED',
  ops_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create helper function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Create helper function to get user's client_id
CREATE OR REPLACE FUNCTION public.get_user_client_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT client_id FROM public.user_roles
  WHERE user_id = _user_id AND role = 'CLIENT'
  LIMIT 1
$$;

-- Create helper function to check if user can access client
CREATE OR REPLACE FUNCTION public.can_access_client(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    public.has_role(_user_id, 'ADMIN') OR 
    public.has_role(_user_id, 'OPS') OR
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND client_id = _client_id
    )
$$;

-- Create function to generate order number
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := 'ORD-' || LPAD(nextval('public.order_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger for order number generation
CREATE TRIGGER set_order_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_order_number();

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Add updated_at triggers
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_green_coffee_lots_updated_at BEFORE UPDATE ON public.green_coffee_lots FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_production_plan_items_updated_at BEFORE UPDATE ON public.production_plan_items FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Enable RLS on all tables
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_coffee_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for clients
CREATE POLICY "Admin/Ops can view all clients" ON public.clients
  FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can view own client" ON public.clients
  FOR SELECT USING (public.get_user_client_id(auth.uid()) = id);

CREATE POLICY "Admin can manage clients" ON public.clients
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY "Ops can update clients" ON public.clients
  FOR UPDATE USING (public.has_role(auth.uid(), 'OPS'));

-- RLS Policies for user_roles
CREATE POLICY "Admin can manage all roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY "Users can view own role" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid());

-- RLS Policies for profiles  
CREATE POLICY "Admin/Ops can view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Users can view/update own profile" ON public.profiles
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Admin can manage all profiles" ON public.profiles
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN'));

-- RLS Policies for products
CREATE POLICY "Admin/Ops can view all products" ON public.products
  FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can view own products" ON public.products
  FOR SELECT USING (public.get_user_client_id(auth.uid()) = client_id AND is_active = true);

CREATE POLICY "Admin/Ops can manage products" ON public.products
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- RLS Policies for price_list
CREATE POLICY "Admin/Ops can view all prices" ON public.price_list
  FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can view own product prices" ON public.price_list
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.products p 
      WHERE p.id = product_id 
      AND p.client_id = public.get_user_client_id(auth.uid())
    )
  );

CREATE POLICY "Admin/Ops can manage prices" ON public.price_list
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- RLS Policies for green_coffee_lots (internal only)
CREATE POLICY "Admin/Ops can manage green coffee" ON public.green_coffee_lots
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- RLS Policies for orders
CREATE POLICY "Admin/Ops can view all orders" ON public.orders
  FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can view own orders" ON public.orders
  FOR SELECT USING (public.get_user_client_id(auth.uid()) = client_id);

CREATE POLICY "Admin/Ops can manage all orders" ON public.orders
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can create own orders" ON public.orders
  FOR INSERT WITH CHECK (public.get_user_client_id(auth.uid()) = client_id);

CREATE POLICY "Clients can update own draft/submitted orders" ON public.orders
  FOR UPDATE USING (
    public.get_user_client_id(auth.uid()) = client_id 
    AND status IN ('DRAFT', 'SUBMITTED')
  );

-- RLS Policies for order_line_items
CREATE POLICY "Admin/Ops can view all line items" ON public.order_line_items
  FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can view own order line items" ON public.order_line_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o 
      WHERE o.id = order_id 
      AND o.client_id = public.get_user_client_id(auth.uid())
    )
  );

CREATE POLICY "Admin/Ops can manage all line items" ON public.order_line_items
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Clients can manage own order line items" ON public.order_line_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.orders o 
      WHERE o.id = order_id 
      AND o.client_id = public.get_user_client_id(auth.uid())
      AND o.status IN ('DRAFT', 'SUBMITTED')
    )
  );

-- RLS Policies for production_plan_items (internal only)
CREATE POLICY "Admin/Ops can manage production plan" ON public.production_plan_items
  FOR ALL USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- Create indexes for performance
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_client_id ON public.user_roles(client_id);
CREATE INDEX idx_products_client_id ON public.products(client_id);
CREATE INDEX idx_price_list_product_id ON public.price_list(product_id);
CREATE INDEX idx_orders_client_id ON public.orders(client_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_order_line_items_order_id ON public.order_line_items(order_id);
CREATE INDEX idx_production_plan_items_target_date ON public.production_plan_items(target_date);
CREATE INDEX idx_production_plan_items_status ON public.production_plan_items(status);