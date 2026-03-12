
-- Step 1: Clear and drop green_coffee_lots
DELETE FROM green_coffee_lots;
DROP TABLE IF EXISTS green_coffee_lots CASCADE;

-- Step 2: Create new enums
CREATE TYPE public.green_coffee_category AS ENUM ('BULK_BLENDER', 'SINGLE_ORIGIN', 'SUPER_NICE');
CREATE TYPE public.sample_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE public.contract_status AS ENUM ('ACTIVE', 'DEPLETED', 'CANCELLED');
CREATE TYPE public.lot_status AS ENUM ('PENDING_DELIVERY', 'RECEIVED', 'COSTING_INCOMPLETE', 'COSTING_COMPLETE');

-- Step 3: Create green_vendors
CREATE TABLE public.green_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  payment_terms_days integer,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.green_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_vendors" ON public.green_vendors FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_vendors" ON public.green_vendors FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 4: Create green_samples
CREATE TABLE public.green_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.green_vendors(id),
  name text NOT NULL,
  origin text,
  producer text,
  variety text,
  category green_coffee_category NOT NULL,
  indicative_price_usd numeric,
  bag_size_kg numeric,
  warehouse_location text,
  score numeric,
  tasting_notes text,
  status sample_status NOT NULL DEFAULT 'PENDING',
  rejected_reason text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.green_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_samples" ON public.green_samples FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_samples" ON public.green_samples FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 5: Create green_sample_roast_profile_links
CREATE TABLE public.green_sample_roast_profile_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES public.green_samples(id) ON DELETE CASCADE,
  roast_group text NOT NULL REFERENCES public.roast_groups(roast_group) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sample_id, roast_group)
);
ALTER TABLE public.green_sample_roast_profile_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_sample_roast_profile_links" ON public.green_sample_roast_profile_links FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_sample_roast_profile_links" ON public.green_sample_roast_profile_links FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 6: Create green_contracts
CREATE TABLE public.green_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.green_vendors(id),
  sample_id uuid REFERENCES public.green_samples(id),
  name text NOT NULL,
  origin text,
  producer text,
  variety text,
  category green_coffee_category NOT NULL,
  contracted_price_usd numeric,
  num_bags integer,
  bag_size_kg numeric,
  total_kg numeric,
  warehouse_location text NOT NULL,
  status contract_status NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.green_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_contracts" ON public.green_contracts FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_contracts" ON public.green_contracts FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 7: Create green_lots
CREATE TABLE public.green_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.green_contracts(id),
  lot_number text NOT NULL,
  bags_released integer NOT NULL,
  bag_size_kg numeric NOT NULL,
  kg_received numeric,
  kg_on_hand numeric NOT NULL DEFAULT 0,
  expected_delivery_date date,
  received_date date,
  carrier text,
  status lot_status NOT NULL DEFAULT 'PENDING_DELIVERY',
  warehouse_location text,
  invoice_amount_usd numeric,
  invoice_amount_usd_confirmed_by uuid REFERENCES auth.users(id),
  invoice_amount_usd_confirmed_at timestamptz,
  carry_fees_usd numeric,
  carry_fees_usd_confirmed_by uuid REFERENCES auth.users(id),
  carry_fees_usd_confirmed_at timestamptz,
  lot_fx_rate numeric,
  lot_fx_rate_confirmed_by uuid REFERENCES auth.users(id),
  lot_fx_rate_confirmed_at timestamptz,
  freight_cad numeric,
  freight_cad_confirmed_by uuid REFERENCES auth.users(id),
  freight_cad_confirmed_at timestamptz,
  duties_cad numeric,
  duties_cad_confirmed_by uuid REFERENCES auth.users(id),
  duties_cad_confirmed_at timestamptz,
  transaction_fees_cad numeric,
  transaction_fees_cad_confirmed_by uuid REFERENCES auth.users(id),
  transaction_fees_cad_confirmed_at timestamptz,
  handling_cad numeric,
  handling_cad_confirmed_by uuid REFERENCES auth.users(id),
  handling_cad_confirmed_at timestamptz,
  costing_complete boolean NOT NULL DEFAULT false,
  costing_completed_at timestamptz,
  financing_apr numeric DEFAULT 0.12,
  importer_payment_terms_days integer,
  estimated_days_to_consume integer,
  available_to_members boolean NOT NULL DEFAULT false,
  member_markup_pct numeric DEFAULT 15.0,
  member_facing_notes text,
  notes_internal text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.green_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_lots" ON public.green_lots FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_lots" ON public.green_lots FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 8: Create green_lot_roast_group_links
CREATE TABLE public.green_lot_roast_group_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.green_lots(id) ON DELETE CASCADE,
  roast_group text NOT NULL REFERENCES public.roast_groups(roast_group) ON DELETE RESTRICT,
  pct_of_lot numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lot_id, roast_group)
);
ALTER TABLE public.green_lot_roast_group_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_lot_roast_group_links" ON public.green_lot_roast_group_links FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_lot_roast_group_links" ON public.green_lot_roast_group_links FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 9: Create green_lot_consumption_log
CREATE TABLE public.green_lot_consumption_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.green_lots(id),
  roasted_batch_id uuid REFERENCES public.roasted_batches(id) ON DELETE SET NULL,
  kg_consumed numeric NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.green_lot_consumption_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_lot_consumption_log" ON public.green_lot_consumption_log FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_lot_consumption_log" ON public.green_lot_consumption_log FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 10: Create green_inventory_snapshots
CREATE TABLE public.green_inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  lot_id uuid NOT NULL REFERENCES public.green_lots(id),
  kg_on_hand numeric NOT NULL,
  book_value_per_kg numeric,
  total_book_value numeric,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, lot_id)
);
ALTER TABLE public.green_inventory_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/Ops can manage green_inventory_snapshots" ON public.green_inventory_snapshots FOR ALL TO authenticated USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role)) WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
CREATE POLICY "Deny anon green_inventory_snapshots" ON public.green_inventory_snapshots FOR ALL TO anon USING (false) WITH CHECK (false);

-- Step 11: Add default_lot_id to roast_group_components
ALTER TABLE public.roast_group_components ADD COLUMN default_lot_id uuid REFERENCES public.green_lots(id) ON DELETE SET NULL;

-- Step 12: Create indexes
CREATE INDEX idx_green_samples_vendor_id ON public.green_samples(vendor_id);
CREATE INDEX idx_green_samples_status ON public.green_samples(status);
CREATE INDEX idx_green_contracts_vendor_id ON public.green_contracts(vendor_id);
CREATE INDEX idx_green_contracts_status ON public.green_contracts(status);
CREATE INDEX idx_green_lots_contract_id ON public.green_lots(contract_id);
CREATE INDEX idx_green_lots_status ON public.green_lots(status);
CREATE INDEX idx_green_lots_available_to_members ON public.green_lots(available_to_members) WHERE available_to_members = true;
CREATE INDEX idx_green_lot_consumption_log_lot_id ON public.green_lot_consumption_log(lot_id);
CREATE INDEX idx_green_lot_consumption_log_roasted_batch_id ON public.green_lot_consumption_log(roasted_batch_id);
CREATE INDEX idx_green_inventory_snapshots_snapshot_date ON public.green_inventory_snapshots(snapshot_date);
