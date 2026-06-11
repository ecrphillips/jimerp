-- Remove the hard WIP-availability block from update_packing_units.
--
-- Business rule (per PackTab): a user packing a bag the system thinks doesn't
-- exist is treated as upstream data-entry lag, not a physical shortage. The UI
-- shows "0 available" / amber cues as a nudge, but packing must never be
-- blocked. This keeps the atomic packing_runs + ledger write (and the
-- DB-recomputed delta under lock) from 20260611090000, minus the exception.

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

  -- Serialize pack updates per roast group so concurrent absolute-target
  -- writes resolve in order against the same locked packing_runs row.
  IF p_roast_group IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('pack_wip:' || p_roast_group));
  END IF;

  SELECT units_packed INTO v_previous_units
  FROM public.packing_runs
  WHERE product_id = p_product_id AND target_date = p_target_date
  FOR UPDATE;

  v_previous_units := COALESCE(v_previous_units, 0);
  v_delta := p_new_units - v_previous_units;
  IF v_delta = 0 THEN
    RETURN p_new_units;
  END IF;

  v_kg_delta := CASE WHEN p_bag_size_g > 0 THEN (v_delta * p_bag_size_g) / 1000.0 ELSE 0 END;

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
