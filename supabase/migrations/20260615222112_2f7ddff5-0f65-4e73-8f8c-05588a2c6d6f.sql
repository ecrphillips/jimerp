
-- 1) accounts columns
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS production_weekdays smallint[],
  ADD COLUMN IF NOT EXISTS order_cutoff_hour smallint NOT NULL DEFAULT 12;

DO $$ BEGIN
  ALTER TABLE public.accounts
    ADD CONSTRAINT accounts_order_cutoff_hour_range
      CHECK (order_cutoff_hour >= 0 AND order_cutoff_hour <= 23);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) internal-staff assertion helper
CREATE OR REPLACE FUNCTION public._assert_internal_staff()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.has_role(auth.uid(), 'ADMIN') OR public.has_role(auth.uid(), 'OPS')) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- 3) execute_blend
CREATE OR REPLACE FUNCTION public.execute_blend(
  p_blend_roast_group text,
  p_blend_display_name text,
  p_batch_ids uuid[],
  p_consume_kgs numeric[]
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric := 0;
  v_locked_count int;
  v_batch RECORD;
  i int;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_batch_ids IS NULL OR array_length(p_batch_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No batches selected';
  END IF;
  IF array_length(p_batch_ids, 1) <> array_length(p_consume_kgs, 1) THEN
    RAISE EXCEPTION 'Batch ids and consume kgs must have the same length';
  END IF;

  SELECT count(*) INTO v_locked_count
  FROM public.roasted_batches
  WHERE id = ANY (p_batch_ids)
    AND status = 'ROASTED'
    AND consumed_by_blend_at IS NULL
  FOR UPDATE;

  IF v_locked_count <> array_length(p_batch_ids, 1) THEN
    RAISE EXCEPTION 'Blend aborted: % batch(es) already consumed by another blend. Refresh and try again.',
      array_length(p_batch_ids, 1) - v_locked_count;
  END IF;

  UPDATE public.roasted_batches
  SET consumed_by_blend_at = now()
  WHERE id = ANY (p_batch_ids);

  FOR i IN 1 .. array_length(p_batch_ids, 1) LOOP
    IF p_consume_kgs[i] IS NULL OR p_consume_kgs[i] <= 0 THEN
      RAISE EXCEPTION 'Consume kg must be positive for batch %', p_batch_ids[i];
    END IF;

    SELECT id, roast_group, actual_output_kg INTO v_batch
    FROM public.roasted_batches
    WHERE id = p_batch_ids[i];

    IF p_consume_kgs[i] > v_batch.actual_output_kg + 0.001 THEN
      RAISE EXCEPTION 'Cannot consume % kg from batch % (output % kg)',
        round(p_consume_kgs[i], 2), p_batch_ids[i], round(v_batch.actual_output_kg, 2);
    END IF;

    v_total := v_total + p_consume_kgs[i];

    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes)
    VALUES
      ('ADJUSTMENT', v_batch.roast_group, -p_consume_kgs[i], true, auth.uid(),
       'Blended into ' || p_blend_display_name || ' (batch ' || left(p_batch_ids[i]::text, 8) || ')');
  END LOOP;

  INSERT INTO public.inventory_transactions
    (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes)
  VALUES
    ('ADJUSTMENT', p_blend_roast_group, v_total, true, auth.uid(),
     'Created blend from ' || array_length(p_batch_ids, 1) || ' component batches');

  RETURN v_total;
END;
$$;

-- 4) update_packing_units (no WIP gate variant)
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

-- 5) mark_batch_roasted
CREATE OR REPLACE FUNCTION public.mark_batch_roasted(
  p_batch_id uuid,
  p_actual_output_kg numeric,
  p_lot_id uuid DEFAULT NULL,
  p_loss_kg numeric DEFAULT 0,
  p_loss_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
  v_lot RECORD;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_actual_output_kg IS NULL OR p_actual_output_kg < 0 THEN
    RAISE EXCEPTION 'Output kg must be >= 0';
  END IF;

  SELECT id, status, roast_group INTO v_batch
  FROM public.roasted_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;

  IF v_batch.status <> 'PLANNED' THEN
    RETURN false;
  END IF;

  UPDATE public.roasted_batches
  SET status = 'ROASTED', actual_output_kg = p_actual_output_kg
  WHERE id = p_batch_id;

  INSERT INTO public.inventory_transactions
    (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes)
  VALUES
    ('ROAST_OUTPUT', v_batch.roast_group, p_actual_output_kg, true, auth.uid(),
     'Batch ' || left(p_batch_id::text, 8));

  IF COALESCE(p_loss_kg, 0) > 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes)
    VALUES
      ('LOSS', v_batch.roast_group, -p_loss_kg, false, auth.uid(), p_loss_note);
  END IF;

  IF p_lot_id IS NOT NULL THEN
    SELECT id, kg_on_hand INTO v_lot
    FROM public.green_lots
    WHERE id = p_lot_id
    FOR UPDATE;

    IF v_lot.id IS NULL THEN
      RAISE EXCEPTION 'Green lot % no longer exists — re-select a lot', p_lot_id;
    END IF;

    INSERT INTO public.green_lot_consumption_log
      (lot_id, roasted_batch_id, kg_consumed, created_by, notes)
    VALUES
      (p_lot_id, p_batch_id, p_actual_output_kg, auth.uid(), 'Batch ' || left(p_batch_id::text, 8));

    UPDATE public.green_lots
    SET kg_on_hand = GREATEST(0, kg_on_hand - p_actual_output_kg),
        updated_at = now()
    WHERE id = p_lot_id;
  END IF;

  RETURN true;
END;
$$;

-- 6) revert_batch_to_planned
CREATE OR REPLACE FUNCTION public.revert_batch_to_planned(
  p_batch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
BEGIN
  PERFORM public._assert_internal_staff();

  SELECT id, status, roast_group, actual_output_kg, consumed_by_blend_at INTO v_batch
  FROM public.roasted_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;

  IF v_batch.status <> 'ROASTED' THEN
    RETURN false;
  END IF;

  IF v_batch.consumed_by_blend_at IS NOT NULL THEN
    RAISE EXCEPTION 'Batch has been consumed by a blend and cannot be reverted';
  END IF;

  UPDATE public.roasted_batches
  SET status = 'PLANNED'
  WHERE id = p_batch_id;

  IF v_batch.actual_output_kg <> 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes)
    VALUES
      ('ADJUSTMENT', v_batch.roast_group, -v_batch.actual_output_kg, true, auth.uid(),
       'Reverted batch ' || left(p_batch_id::text, 8) || ' to planned');
  END IF;

  RETURN true;
END;
$$;

-- 7) Grants
REVOKE EXECUTE ON FUNCTION public._assert_internal_staff()                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.execute_blend(text, text, uuid[], numeric[])              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_packing_units(uuid, date, integer, numeric, text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_batch_roasted(uuid, numeric, uuid, numeric, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revert_batch_to_planned(uuid)                             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.execute_blend(text, text, uuid[], numeric[])               TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_packing_units(uuid, date, integer, numeric, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_batch_roasted(uuid, numeric, uuid, numeric, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_batch_to_planned(uuid)                              TO authenticated;
