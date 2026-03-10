
-- =============================================
-- 1. CREATE NEW TABLES
-- =============================================

-- accounts
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name text NOT NULL,
  billing_contact_name text,
  billing_email text,
  billing_phone text,
  billing_address text,
  notes_internal text,
  is_active boolean NOT NULL DEFAULT true,
  programs text[] NOT NULL DEFAULT '{}',
  relationship_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  coroast_tier text,
  coroast_joined_date date,
  coroast_certified boolean NOT NULL DEFAULT false,
  coroast_certified_date date,
  coroast_certified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

-- account_locations
CREATE TABLE public.account_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  location_name text NOT NULL,
  location_code text NOT NULL,
  address text,
  qbo_billing_entity text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, location_code)
);

ALTER TABLE public.account_locations ENABLE ROW LEVEL SECURITY;

-- account_users
CREATE TABLE public.account_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_owner boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  can_place_orders boolean NOT NULL DEFAULT true,
  can_book_roaster boolean NOT NULL DEFAULT false,
  can_manage_locations boolean NOT NULL DEFAULT false,
  can_invite_users boolean NOT NULL DEFAULT false,
  location_access text NOT NULL DEFAULT 'ALL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id)
);

ALTER TABLE public.account_users ENABLE ROW LEVEL SECURITY;

-- account_user_locations
CREATE TABLE public.account_user_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id uuid NOT NULL REFERENCES public.account_users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.account_locations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_user_id, location_id)
);

ALTER TABLE public.account_user_locations ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 2. UPDATE EXISTING TABLES
-- =============================================

-- orders
ALTER TABLE public.orders
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  ADD COLUMN account_location_id uuid REFERENCES public.account_locations(id) ON DELETE SET NULL;

-- coroast_bookings
ALTER TABLE public.coroast_bookings
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- coroast_billing_periods
ALTER TABLE public.coroast_billing_periods
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- coroast_storage_allocations
ALTER TABLE public.coroast_storage_allocations
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- coroast_invoices
ALTER TABLE public.coroast_invoices
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- coroast_waiver_log
ALTER TABLE public.coroast_waiver_log
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- coroast_hour_ledger
ALTER TABLE public.coroast_hour_ledger
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- prospects (converted_to_account_id)
ALTER TABLE public.prospects
  ADD COLUMN converted_to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

-- =============================================
-- 3. ADD INDEXES
-- =============================================

CREATE INDEX idx_account_locations_account_id ON public.account_locations(account_id);
CREATE INDEX idx_account_users_account_id ON public.account_users(account_id);
CREATE INDEX idx_account_users_user_id ON public.account_users(user_id);
CREATE INDEX idx_account_user_locations_account_user_id ON public.account_user_locations(account_user_id);
CREATE INDEX idx_orders_account_id ON public.orders(account_id);
CREATE INDEX idx_coroast_bookings_account_id ON public.coroast_bookings(account_id);

-- =============================================
-- 4. RLS POLICIES
-- =============================================

-- accounts: Admin/Ops full access
CREATE POLICY "Admin/Ops can manage accounts" ON public.accounts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon accounts" ON public.accounts
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- account_locations: Admin/Ops full access
CREATE POLICY "Admin/Ops can manage account_locations" ON public.account_locations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon account_locations" ON public.account_locations
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- account_users: Admin/Ops full access
CREATE POLICY "Admin/Ops can manage account_users" ON public.account_users
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon account_users" ON public.account_users
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- account_user_locations: Admin/Ops full access
CREATE POLICY "Admin/Ops can manage account_user_locations" ON public.account_user_locations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon account_user_locations" ON public.account_user_locations
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- updated_at triggers
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_account_locations_updated_at BEFORE UPDATE ON public.account_locations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_account_users_updated_at BEFORE UPDATE ON public.account_users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
