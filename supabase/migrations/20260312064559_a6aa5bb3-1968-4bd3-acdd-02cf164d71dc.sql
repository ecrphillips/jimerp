
-- Step 1: Add new columns to green_contracts
ALTER TABLE public.green_contracts ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.green_contracts ADD COLUMN IF NOT EXISTS crop_year text;
ALTER TABLE public.green_contracts ADD COLUMN IF NOT EXISTS contracted_price_per_kg numeric;
ALTER TABLE public.green_contracts ADD COLUMN IF NOT EXISTS contracted_price_currency text DEFAULT 'USD';

-- Step 2: Update lot_status enum — rename PENDING_DELIVERY to EN_ROUTE
ALTER TYPE public.lot_status RENAME VALUE 'PENDING_DELIVERY' TO 'EN_ROUTE';

-- Step 3: Add new columns to green_lots
ALTER TABLE public.green_lots ADD COLUMN IF NOT EXISTS exceptions_noted boolean NOT NULL DEFAULT false;
ALTER TABLE public.green_lots ADD COLUMN IF NOT EXISTS exceptions_notes text;
ALTER TABLE public.green_lots ADD COLUMN IF NOT EXISTS arrival_snoozed_until date;
ALTER TABLE public.green_lots ADD COLUMN IF NOT EXISTS vendor_release_communicated_at timestamptz;
ALTER TABLE public.green_lots ADD COLUMN IF NOT EXISTS vendor_release_communicated_by uuid REFERENCES auth.users(id);

-- Step 4: Create green_contract_notes table
CREATE TABLE public.green_contract_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.green_contracts(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.green_contract_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_contract_notes FORCE ROW LEVEL SECURITY;

-- RLS: deny anon
CREATE POLICY "anon_denied" ON public.green_contract_notes FOR ALL TO anon USING (false);

-- RLS: admin/ops full access
CREATE POLICY "admin_ops_all" ON public.green_contract_notes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- Step 5: Create green_lot_notes table
CREATE TABLE public.green_lot_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.green_lots(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.green_lot_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_lot_notes FORCE ROW LEVEL SECURITY;

-- RLS: deny anon
CREATE POLICY "anon_denied" ON public.green_lot_notes FOR ALL TO anon USING (false);

-- RLS: admin/ops full access
CREATE POLICY "admin_ops_all" ON public.green_lot_notes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));
