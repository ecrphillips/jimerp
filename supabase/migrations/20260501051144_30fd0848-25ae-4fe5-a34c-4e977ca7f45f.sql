-- ============================================================================
-- Layer 2A — Quote Builder skeleton
-- ============================================================================

-- 1) Sequence + generator function for quote_number
CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
    NEW.quote_number := 'Q-' || LPAD(nextval('public.quote_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_quote_number() FROM PUBLIC, anon, authenticated;

-- 2) quotes table
CREATE TABLE public.quotes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_number TEXT NOT NULL UNIQUE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  prospect_id UUID REFERENCES public.prospects(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  title TEXT,
  internal_notes TEXT,
  customer_notes TEXT,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT quotes_status_check CHECK (status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED')),
  CONSTRAINT quotes_recipient_xor CHECK (
    ((account_id IS NOT NULL)::int + (prospect_id IS NOT NULL)::int) = 1
  )
);

CREATE INDEX idx_quotes_account_id ON public.quotes(account_id);
CREATE INDEX idx_quotes_prospect_id ON public.quotes(prospect_id);
CREATE INDEX idx_quotes_status ON public.quotes(status);
CREATE INDEX idx_quotes_updated_at ON public.quotes(updated_at DESC);

-- BEFORE INSERT trigger to populate quote_number
CREATE TRIGGER set_quote_number
  BEFORE INSERT ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_quote_number();

-- updated_at trigger
CREATE TRIGGER update_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 3) quote_line_items table
CREATE TABLE public.quote_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,

  -- pricing inputs
  green_lot_id UUID REFERENCES public.green_lots(id) ON DELETE SET NULL,
  blend_components JSONB,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  packaging_variant TEXT NOT NULL,
  bag_size_g INTEGER NOT NULL,
  quantity_bags INTEGER NOT NULL DEFAULT 1,
  tier_id_override UUID REFERENCES public.pricing_tiers(id) ON DELETE SET NULL,
  profile_id_override UUID REFERENCES public.pricing_rule_profiles(id) ON DELETE SET NULL,

  -- calc snapshot
  calc_total_cost_per_bag NUMERIC,
  calc_list_price_per_bag NUMERIC,
  calc_final_price_per_bag NUMERIC,
  calc_margin_pct NUMERIC,
  calc_payload JSONB,
  calc_warnings JSONB,
  calc_at TIMESTAMPTZ,

  -- line-level overrides
  final_price_per_bag_override NUMERIC,
  override_reason TEXT,
  line_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT qli_green_xor CHECK (
    ((green_lot_id IS NOT NULL)::int + (blend_components IS NOT NULL)::int) = 1
  ),
  CONSTRAINT qli_override_reason_required CHECK (
    final_price_per_bag_override IS NULL
    OR (override_reason IS NOT NULL AND length(btrim(override_reason)) > 0)
  )
);

CREATE INDEX idx_quote_line_items_quote_order ON public.quote_line_items(quote_id, display_order);

CREATE TRIGGER update_quote_line_items_updated_at
  BEFORE UPDATE ON public.quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 4) RLS
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Ops can manage quotes"
  ON public.quotes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anonymous access to quotes"
  ON public.quotes
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Admin/Ops can manage quote_line_items"
  ON public.quote_line_items
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::app_role) OR public.has_role(auth.uid(), 'OPS'::app_role));

CREATE POLICY "Deny anonymous access to quote_line_items"
  ON public.quote_line_items
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);
