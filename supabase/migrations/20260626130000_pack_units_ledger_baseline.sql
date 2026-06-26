-- Make update_packing_units reverse against the authoritative FG ledger.
--
-- Bug: the pack units field was not reversible. The RPC computed its "previous
-- units" baseline from the legacy per-day packing_runs row scoped to the passed
-- target_date (always *today* in the UI). packing_runs is keyed by
-- (product_id, target_date), so a pack run recorded on an earlier day — or any
-- divergence between the date-agnostic packed count shown in the UI and today's
-- row — gave the RPC a baseline of 0. Editing the units field down (or to zero)
-- then computed delta = new - 0 and wrote NO reversing rows: the FG units stayed
-- in the ledger and the consumed WIP was never returned, while the on-screen
-- status (derived from a different aggregation) still flipped to pending. Ledger
-- and status disagreed.
--
-- Fix: derive the baseline from the inventory_transactions ledger — the single
-- source of truth this app now uses for FG. Net produced for a product is
-- sum(quantity_units) over PACK_PRODUCE_FG, which is date-agnostic. delta =
-- new - net_produced therefore always balances BOTH sides for any edit:
--   * increase  -> positive PACK_PRODUCE_FG (+units) and PACK_CONSUME_WIP (-kg)
--   * decrease  -> negative PACK_PRODUCE_FG (-units) and PACK_CONSUME_WIP (+kg)
--   * set to 0  -> fully reverses the whole run on both sides
-- Every row carries the logged-in user (auth.uid()) and a default created_at.
-- The packing_runs upsert is kept only for legacy back-compat; no inventory math
-- reads it any more.

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

  -- Authoritative, date-agnostic baseline: net units already produced for this
  -- product per the FG ledger. (Was: today's packing_runs.units_packed row,
  -- which broke reversal whenever the run lived under a different date.)
  SELECT COALESCE(SUM(quantity_units), 0)::integer INTO v_previous_units
  FROM public.inventory_transactions
  WHERE product_id = p_product_id
    AND transaction_type = 'PACK_PRODUCE_FG';

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
