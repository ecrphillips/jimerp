-- Baskets — Phase 1 (Sourcing only).
--
-- A basket is a named green coffee profile we keep in stock year-round
-- (e.g. Brazil, Washed Ethiopia). Lots belong to baskets through basket_lots:
--   active_pct IS NULL  -> lot is "lined up" (queued to become active)
--   active_pct = number -> lot is "active" at that percentage of the basket
-- A lot may sit in more than one basket. Deleting a basket removes its
-- memberships only, never the lots. Deleting a lot removes its memberships.
--
-- green_lots.source_sample_id records the sample a placeholder lot was
-- created from (Baskets → "Add from sample").
--
-- RLS mirrors green_lots: ADMIN/OPS full access, no client/member access.

-- ── baskets ──────────────────────────────────────────────────────────────
CREATE TABLE public.baskets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

-- Names are unique ignoring case (and surrounding spaces).
CREATE UNIQUE INDEX baskets_name_unique_ci ON public.baskets (lower(btrim(name)));

CREATE TRIGGER update_baskets_updated_at
  BEFORE UPDATE ON public.baskets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.baskets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage baskets" ON public.baskets
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon baskets" ON public.baskets
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- ── basket_lots ──────────────────────────────────────────────────────────
CREATE TABLE public.basket_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  basket_id uuid NOT NULL REFERENCES public.baskets(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES public.green_lots(id) ON DELETE CASCADE,
  active_pct numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT basket_lots_basket_lot_unique UNIQUE (basket_id, lot_id)
);

COMMENT ON COLUMN public.basket_lots.active_pct IS
  'NULL = lined up; a number = active at that percentage of the basket';

CREATE INDEX idx_basket_lots_lot_id ON public.basket_lots (lot_id);

ALTER TABLE public.basket_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage basket_lots" ON public.basket_lots
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anon basket_lots" ON public.basket_lots
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- ── green_lots.source_sample_id ──────────────────────────────────────────
ALTER TABLE public.green_lots
  ADD COLUMN source_sample_id uuid REFERENCES public.green_samples(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.green_lots.source_sample_id IS
  'Set when a placeholder lot is created from a sample (Baskets → Add from sample)';

-- New tables/column: refresh PostgREST's schema cache so the API sees them.
NOTIFY pgrst, 'reload schema';