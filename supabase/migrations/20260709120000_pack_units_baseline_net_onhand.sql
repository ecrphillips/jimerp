-- Make update_packing_units baseline the NET FG on-hand, not gross produced.
--
-- Bug: the pack-units field's baseline was sum(PACK_PRODUCE_FG) — gross,
-- all-time produced. That count never drops when bags ship, so once any FG for
-- a SKU shipped out, the "units packed" input kept showing the historical gross
-- (e.g. 4) even though 0 were physically on hand, and completeness read stale.
-- The absolute-target UI sends p_new_units; delta = new - gross_baseline then
-- under-recorded fresh production: packing 9 against a gross baseline of 4 wrote
-- only +5 FG, leaving net on-hand at 5 instead of 9.
--
-- Fix: baseline the net physical on-hand — sum(quantity_units) over
-- PACK_PRODUCE_FG (+), SHIP_CONSUME_FG (−, written on pick/ship/return), and
-- ADJUSTMENT (floor count), floored at 0. This is exactly fg_available_units in
-- src/hooks/useAuthoritativeInventory.ts, which the Pack tab input now binds to,
-- so the on-screen value and the RPC baseline always agree and delta drives net
-- on-hand to the entered target:
--   SKU packed 4 then all shipped -> net 0, input shows 0; pack 9 -> delta 9,
--   writes +9 FG (and consumes 9 bags of WIP), net on-hand = 9.
-- Never-shipped SKUs are unaffected: net == gross, so baseline is unchanged.
--
-- Only the baseline SELECT changes; the delta / WIP-return / FG-write / advisory
-- lock logic is identical to 20260626130000_pack_units_ledger_baseline.sql.

CREATE OR REPLACE FUNCTION public.update_packing_units(
  p_product_id uuid,
  p_target_date date,
  p_new_units integer,
  p_bag_size_g numeric,
  p_roast_group text
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
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_new_units IS NULL OR p_new_units < 0 THEN
    RAISE EXCEPTION 'Units must be >= 0';
  END IF;

  -- Serialize pack updates per roast group so concurrent absolute-target writes
  -- resolve in order against the same baseline (last-arrived wins, not lost).
  IF p_roast_group IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('pack_wip:' || p_roast_group));
  END IF;

  -- Authoritative baseline: net FG on-hand per the ledger, floored at 0 — the
  -- same value as fg_available_units and the number the Pack tab input shows.
  -- (Was: sum of PACK_PRODUCE_FG only, i.e. gross produced, which stayed high
  -- after bags shipped and desynced the input from physical stock.)
  SELECT GREATEST(0, COALESCE(SUM(quantity_units), 0))::integer
    INTO v_previous_units
  FROM public.inventory_transactions
  WHERE product_id = p_product_id
    AND transaction_type IN ('PACK_PRODUCE_FG', 'SHIP_CONSUME_FG', 'ADJUSTMENT');

  v_delta := p_new_units - v_previous_units;
  IF v_delta = 0 THEN
    RETURN p_new_units;
  END IF;

  v_kg_delta := CASE WHEN p_bag_size_g > 0 THEN (v_delta * p_bag_size_g) / 1000.0 ELSE 0 END;

  -- Legacy back-compat only; FG/WIP are read from the ledger, not this table.
  INSERT INTO public.packing_runs (product_id, target_date, units_packed, kg_consumed, updated_by)
  VALUES (
    p_product_id,
    p_target_date,
    p_new_units,
    CASE WHEN p_bag_size_g > 0 THEN (p_new_units * p_bag_size_g) / 1000.0 ELSE 0 END,
    auth.uid()
  )
  ON CONFLICT (product_id, target_date) DO UPDATE
  SET units_packed = EXCLUDED.units_packed,
      kg_consumed = EXCLUDED.kg_consumed,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  -- Return / consume WIP for the difference. quantity_kg = -v_kg_delta:
  -- a decrease (v_delta < 0) yields a positive kg row, returning WIP.
  IF p_roast_group IS NOT NULL AND v_kg_delta <> 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, product_id, quantity_kg, quantity_units, is_system_generated, created_by, notes)
    VALUES
      ('PACK_CONSUME_WIP', p_roast_group, p_product_id, -v_kg_delta, NULL, true, auth.uid(),
       CASE WHEN v_delta > 0
         THEN 'Packed ' || v_delta || ' units of ' || p_bag_size_g || 'g'
         ELSE 'Reversed ' || abs(v_delta) || ' units of ' || p_bag_size_g || 'g'
       END);
  END IF;

  -- Add / remove FG for the difference. quantity_units = v_delta:
  -- a decrease (v_delta < 0) removes the now-unpacked units from FG.
  INSERT INTO public.inventory_transactions
    (transaction_type, roast_group, product_id, quantity_kg, quantity_units, is_system_generated, created_by, notes)
  VALUES
    ('PACK_PRODUCE_FG', p_roast_group, p_product_id, NULL, v_delta, true, auth.uid(),
     CASE WHEN v_delta > 0
       THEN 'Packed ' || v_delta || ' units'
       ELSE 'Reversed ' || abs(v_delta) || ' units'
     END);

  RETURN p_new_units;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_packing_units(uuid, date, integer, numeric, text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_packing_units(uuid, date, integer, numeric, text)  TO authenticated;
