-- 1) Add timestamps to quotes
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- (status column already exists with CHECK including DRAFT/SENT/ACCEPTED)
-- Backfill: ensure any nulls become DRAFT (status is NOT NULL DEFAULT 'DRAFT' so nothing to do, but be defensive)
UPDATE public.quotes SET status = 'DRAFT' WHERE status IS NULL;

-- 2) locked_prices table
CREATE TABLE IF NOT EXISTS public.locked_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  bag_size_g integer NOT NULL,
  green_source_type text NOT NULL CHECK (green_source_type IN ('GREEN_LOT','ROAST_GROUP','THEORETICAL_BLEND')),
  green_source_id uuid,
  theoretical_blend_ratios jsonb,
  locked_price numeric NOT NULL,
  source_quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  source_quote_line_id uuid NOT NULL REFERENCES public.quote_line_items(id) ON DELETE CASCADE,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  expires_at date,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  archived_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locked_prices_account ON public.locked_prices (account_id);
CREATE INDEX IF NOT EXISTS idx_locked_prices_product ON public.locked_prices (product_id);
CREATE INDEX IF NOT EXISTS idx_locked_prices_quote ON public.locked_prices (source_quote_id);
CREATE INDEX IF NOT EXISTS idx_locked_prices_lookup
  ON public.locked_prices (account_id, product_id, bag_size_g)
  WHERE is_archived = false;

-- Unique partial index: one active lock per combination
-- COALESCE used so NULL green_source_id (THEORETICAL_BLEND) still uniqueness-checks
CREATE UNIQUE INDEX IF NOT EXISTS uniq_locked_prices_active_combo
  ON public.locked_prices (
    account_id, product_id, bag_size_g, green_source_type,
    COALESCE(green_source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE is_archived = false;

CREATE TRIGGER trg_locked_prices_updated_at
  BEFORE UPDATE ON public.locked_prices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3) RLS
ALTER TABLE public.locked_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage locked_prices"
  ON public.locked_prices
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY "Admin/Ops can read locked_prices"
  ON public.locked_prices
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS'));

CREATE POLICY "Deny anonymous access to locked_prices"
  ON public.locked_prices
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- 4) Lifecycle RPCs

-- Helper: derive (green_source_type, green_source_id, theoretical_blend_ratios) from a quote line
CREATE OR REPLACE FUNCTION public._derive_green_source(_line_id uuid)
RETURNS TABLE(green_source_type text, green_source_id uuid, theoretical_blend_ratios jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_green_lot_id uuid;
  v_blend jsonb;
BEGIN
  SELECT qli.green_lot_id, qli.blend_components
    INTO v_green_lot_id, v_blend
  FROM public.quote_line_items qli
  WHERE qli.id = _line_id;

  IF v_green_lot_id IS NOT NULL THEN
    RETURN QUERY SELECT 'GREEN_LOT'::text, v_green_lot_id, NULL::jsonb;
  ELSIF v_blend IS NOT NULL THEN
    RETURN QUERY SELECT 'THEORETICAL_BLEND'::text, NULL::uuid, v_blend;
  ELSE
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::jsonb;
  END IF;
END;
$$;

-- mark_quote_sent
CREATE OR REPLACE FUNCTION public.mark_quote_sent(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  UPDATE public.quotes
    SET status = 'SENT',
        sent_at = COALESCE(sent_at, now()),
        updated_at = now()
    WHERE id = p_quote_id;
END;
$$;

-- mark_quote_accepted: status -> ACCEPTED, archive prior matching locks, insert new locks per line
CREATE OR REPLACE FUNCTION public.mark_quote_accepted(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_quote_number text;
  v_line record;
  v_gst text;
  v_gsid uuid;
  v_blend jsonb;
  v_price numeric;
  v_locks_created int := 0;
  v_locks_archived int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  SELECT account_id, quote_number INTO v_account_id, v_quote_number
    FROM public.quotes WHERE id = p_quote_id;

  IF v_quote_number IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  UPDATE public.quotes
    SET status = 'ACCEPTED',
        accepted_at = COALESCE(accepted_at, now()),
        updated_at = now()
    WHERE id = p_quote_id;

  -- Locks only apply to real accounts. Skip silently for prospects.
  IF v_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'accepted', true,
      'locks_created', 0,
      'locks_archived', 0,
      'skipped_reason', 'PROSPECT'
    );
  END IF;

  FOR v_line IN
    SELECT id, product_id, bag_size_g,
           COALESCE(final_price_per_bag_override, calc_final_price_per_bag) AS price
    FROM public.quote_line_items
    WHERE quote_id = p_quote_id
    ORDER BY display_order
  LOOP
    -- Skip lines without product or price
    IF v_line.product_id IS NULL OR v_line.price IS NULL THEN
      CONTINUE;
    END IF;

    SELECT g.green_source_type, g.green_source_id, g.theoretical_blend_ratios
      INTO v_gst, v_gsid, v_blend
    FROM public._derive_green_source(v_line.id) g;

    IF v_gst IS NULL THEN
      CONTINUE;
    END IF;

    -- Archive existing matching active lock(s)
    UPDATE public.locked_prices
      SET is_archived = true,
          archived_at = now(),
          archived_reason = 'Replaced by quote ' || v_quote_number,
          updated_at = now()
      WHERE is_archived = false
        AND account_id = v_account_id
        AND product_id = v_line.product_id
        AND bag_size_g = v_line.bag_size_g
        AND green_source_type = v_gst
        AND COALESCE(green_source_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(v_gsid, '00000000-0000-0000-0000-000000000000'::uuid);
    GET DIAGNOSTICS v_locks_archived = ROW_COUNT;

    INSERT INTO public.locked_prices (
      account_id, product_id, bag_size_g,
      green_source_type, green_source_id, theoretical_blend_ratios,
      locked_price, source_quote_id, source_quote_line_id
    )
    VALUES (
      v_account_id, v_line.product_id, v_line.bag_size_g,
      v_gst, v_gsid, v_blend,
      v_line.price, p_quote_id, v_line.id
    );

    v_locks_created := v_locks_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'accepted', true,
    'locks_created', v_locks_created,
    'locks_archived', v_locks_archived
  );
END;
$$;

-- reverse_quote_to_sent: admin only
CREATE OR REPLACE FUNCTION public.reverse_quote_to_sent(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  UPDATE public.locked_prices
    SET is_archived = true,
        archived_at = now(),
        archived_reason = COALESCE(archived_reason, 'Quote reversed to SENT'),
        updated_at = now()
    WHERE source_quote_id = p_quote_id
      AND is_archived = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.quotes
    SET status = 'SENT',
        accepted_at = NULL,
        updated_at = now()
    WHERE id = p_quote_id;

  RETURN jsonb_build_object('reversed', true, 'locks_archived', v_count);
END;
$$;

-- sync_locked_price_for_quote_line: when an accepted quote's line is edited,
-- update the matching active locked_prices row.
CREATE OR REPLACE FUNCTION public.sync_locked_price_for_quote_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_quote_id uuid;
  v_price numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Access denied: ADMIN or OPS role required';
  END IF;

  SELECT q.status, q.id,
         COALESCE(qli.final_price_per_bag_override, qli.calc_final_price_per_bag)
    INTO v_status, v_quote_id, v_price
  FROM public.quote_line_items qli
  JOIN public.quotes q ON q.id = qli.quote_id
  WHERE qli.id = p_line_id;

  IF v_status <> 'ACCEPTED' OR v_price IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.locked_prices
    SET locked_price = v_price,
        updated_at = now()
    WHERE source_quote_line_id = p_line_id
      AND is_archived = false;
END;
$$;