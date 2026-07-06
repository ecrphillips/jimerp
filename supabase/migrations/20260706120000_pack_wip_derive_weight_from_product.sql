-- Pack reconciliation fix: derive consumed WIP weight from the product, never the caller.
--
-- Bug: update_packing_units took the bag weight (p_bag_size_g) and the roast
-- group (p_roast_group) as caller-supplied arguments, then wrote the
-- PACK_PRODUCE_FG row (units) and the PACK_CONSUME_WIP row (kg) as two
-- independent numbers. Because the kg figure came from a separate input rather
-- than from the bags themselves, FG-in-bags and WIP-in-kg could drift apart and
-- never reconcile by weight.
--
-- Fix: the RPC now looks up the fill weight and mapped roast group from the
-- products row for p_product_id and computes:
--     kg_delta = units_delta * grams_per_unit / 1000
-- Both ledger rows are therefore always tied to the single bag count via the
-- product's stored gram weight. The caller only ever supplies a bag count.
-- grams_per_unit is the source of truth; bag_size_g is the fallback for the few
-- legacy rows where grams_per_unit is still null (in current data the two are
-- identical wherever both are set).
--
-- The p_bag_size_g and p_roast_group parameters are kept for signature
-- compatibility (so this is a drop-in CREATE OR REPLACE and no regenerated
-- types are required) but are IGNORED — the body no longer reads them.
--
-- WIP is allowed to go negative when roasting has not caught up; the packer is
-- never blocked. No upstream-material gating.

CREATE OR REPLACE FUNCTION public.update_packing_units(
  p_product_id uuid,
  p_target_date date,
  p_new_units integer,
  p_bag_size_g numeric,   -- IGNORED: retained only for signature compatibility
  p_roast_group text      -- IGNORED: retained only for signature compatibility
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_previous_units integer := 0;
  v_delta integer;
  v_kg_delta numeric;
  v_grams numeric;
  v_roast_group text;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_new_units IS NULL OR p_new_units < 0 THEN
    RAISE EXCEPTION 'Units must be >= 0';
  END IF;

  -- Authoritative fill weight and roast group come from the product, not the
  -- caller. grams_per_unit is preferred; bag_size_g is the fallback for legacy
  -- rows where grams_per_unit is null.
  SELECT COALESCE(NULLIF(p.grams_per_unit, 0), p.bag_size_g)::numeric,
         p.roast_group
    INTO v_grams, v_roast_group
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  -- Serialize pack updates per roast group so concurrent absolute-target writes
  -- resolve in order against the same baseline (last-arrived wins, not lost).
  IF v_roast_group IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('pack_wip:' || v_roast_group));
  END IF;

  -- Authoritative, date-agnostic baseline: net units already produced for this
  -- product per the FG ledger.
  SELECT COALESCE(SUM(quantity_units), 0)::integer INTO v_previous_units
  FROM public.inventory_transactions
  WHERE product_id = p_product_id
    AND transaction_type = 'PACK_PRODUCE_FG';

  v_delta := p_new_units - v_previous_units;
  IF v_delta = 0 THEN
    RETURN p_new_units;
  END IF;

  -- Consumed WIP is derived from the bag count and the product's stored weight.
  v_kg_delta := CASE WHEN v_grams > 0 THEN (v_delta * v_grams) / 1000.0 ELSE 0 END;

  -- Legacy back-compat only; FG/WIP are read from the ledger, not this table.
  INSERT INTO public.packing_runs (product_id, target_date, units_packed, kg_consumed, updated_by)
  VALUES (
    p_product_id,
    p_target_date,
    p_new_units,
    CASE WHEN v_grams > 0 THEN (p_new_units * v_grams) / 1000.0 ELSE 0 END,
    auth.uid()
  )
  ON CONFLICT (product_id, target_date) DO UPDATE
  SET units_packed = EXCLUDED.units_packed,
      kg_consumed = EXCLUDED.kg_consumed,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  -- Return / consume WIP for the difference. quantity_kg = -v_kg_delta:
  -- a decrease (v_delta < 0) yields a positive kg row, returning WIP.
  -- WIP is allowed to go negative; the packer is never blocked.
  IF v_roast_group IS NOT NULL AND v_kg_delta <> 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, product_id, quantity_kg, quantity_units, is_system_generated, created_by, notes)
    VALUES
      ('PACK_CONSUME_WIP', v_roast_group, p_product_id, -v_kg_delta, NULL, true, auth.uid(),
       CASE WHEN v_delta > 0
         THEN 'Packed ' || v_delta || ' units of ' || v_grams || 'g'
         ELSE 'Reversed ' || abs(v_delta) || ' units of ' || v_grams || 'g'
       END);
  END IF;

  -- Add / remove FG for the difference. quantity_units = v_delta:
  -- a decrease (v_delta < 0) removes the now-unpacked units from FG.
  INSERT INTO public.inventory_transactions
    (transaction_type, roast_group, product_id, quantity_kg, quantity_units, is_system_generated, created_by, notes)
  VALUES
    ('PACK_PRODUCE_FG', v_roast_group, p_product_id, NULL, v_delta, true, auth.uid(),
     CASE WHEN v_delta > 0
       THEN 'Packed ' || v_delta || ' units'
       ELSE 'Reversed ' || abs(v_delta) || ' units'
     END);

  RETURN p_new_units;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_packing_units(uuid, date, integer, numeric, text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_packing_units(uuid, date, integer, numeric, text)  TO authenticated;
