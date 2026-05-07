-- Drop predecessor tables (Standing Offer page is being removed)
DROP TABLE IF EXISTS public.standing_offer_lines CASCADE;
DROP TABLE IF EXISTS public.standing_offer_sessions CASCADE;

-- Workspace lines
CREATE TABLE public.offer_workspace_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  roast_group text NOT NULL,
  packaging_variant text NOT NULL,
  client_facing_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  green_markup_multiplier_override numeric,
  yield_loss_pct_override numeric,
  process_rate_per_kg_override numeric,
  overhead_per_kg_override numeric,
  wiggle_room_per_bag numeric,
  wiggle_room_note text,
  saved_green_cost_per_kg numeric,
  saved_at timestamptz,
  saved_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_offer_workspace_lines_account ON public.offer_workspace_lines(account_id, sort_order);

-- Workspace session per account
CREATE TABLE public.offer_workspace_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  last_saved_at timestamptz,
  last_saved_by uuid REFERENCES auth.users(id)
);

-- Stamp trigger
CREATE OR REPLACE FUNCTION public.stamp_offer_workspace_lines_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_offer_workspace_lines_stamp_update
BEFORE UPDATE ON public.offer_workspace_lines
FOR EACH ROW
EXECUTE FUNCTION public.stamp_offer_workspace_lines_update();

-- RLS: ADMIN/OPS only
ALTER TABLE public.offer_workspace_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_workspace_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops full access on offer_workspace_lines"
ON public.offer_workspace_lines
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Admin/Ops full access on offer_workspace_sessions"
ON public.offer_workspace_sessions
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role));