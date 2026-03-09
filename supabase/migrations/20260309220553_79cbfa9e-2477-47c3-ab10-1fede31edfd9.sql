
CREATE TABLE public.coroast_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.coroast_members(id) ON DELETE CASCADE,
  billing_period_id uuid NOT NULL REFERENCES public.coroast_billing_periods(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  tier_snapshot text NOT NULL,
  base_fee numeric NOT NULL,
  included_hours numeric NOT NULL,
  used_hours numeric NOT NULL,
  overage_hours numeric NOT NULL DEFAULT 0,
  overage_rate numeric NOT NULL,
  overage_charge numeric NOT NULL DEFAULT 0,
  included_pallets integer NOT NULL DEFAULT 0,
  paid_pallets integer NOT NULL DEFAULT 0,
  pallet_rate numeric NOT NULL DEFAULT 0,
  storage_charge numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE(member_id, billing_period_id)
);

ALTER TABLE public.coroast_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coroast_invoices FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.coroast_invoices FROM anon;
REVOKE ALL ON public.coroast_invoices FROM public;

CREATE POLICY "Admin/Ops can manage coroast_invoices"
  ON public.coroast_invoices FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon coroast_invoices"
  ON public.coroast_invoices FOR ALL TO anon
  USING (false) WITH CHECK (false);
