-- Standing Offer tables for Amplified weekly offer sheet
CREATE TABLE public.standing_offer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  roast_group text NOT NULL REFERENCES public.roast_groups(roast_group),
  client_facing_name text NOT NULL,
  price_per_bag numeric(10,2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_standing_offer_lines_account ON public.standing_offer_lines(account_id, sort_order);

CREATE TABLE public.standing_offer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  last_updated_at timestamptz,
  last_updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.standing_offer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standing_offer_sessions ENABLE ROW LEVEL SECURITY;

-- ADMIN/OPS only
CREATE POLICY "admin_ops_all_lines" ON public.standing_offer_lines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "admin_ops_all_sessions" ON public.standing_offer_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

-- Audit trigger
CREATE OR REPLACE FUNCTION public.stamp_standing_offer_line_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER stamp_standing_offer_line_audit_trg
BEFORE UPDATE ON public.standing_offer_lines
FOR EACH ROW EXECUTE FUNCTION public.stamp_standing_offer_line_audit();

CREATE TRIGGER stamp_standing_offer_line_audit_insert_trg
BEFORE INSERT ON public.standing_offer_lines
FOR EACH ROW EXECUTE FUNCTION public.stamp_standing_offer_line_audit();