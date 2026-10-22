CREATE OR REPLACE FUNCTION public.green_kg_for_roasted(p_roasted_kg numeric, p_loss_pct numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_roasted_kg IS NULL THEN 0
    WHEN p_loss_pct IS NULL OR p_loss_pct < 0 OR p_loss_pct >= 100 THEN p_roasted_kg
    ELSE p_roasted_kg / (1 - p_loss_pct / 100)
  END;
$$;

CREATE OR REPLACE FUNCTION public._consume_green_for_batch(p_lot_id uuid, p_batch_id uuid, p_kg numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lot RECORD;
  v_take numeric;
BEGIN
  IF p_kg IS NULL OR p_kg <= 0 THEN
    RETURN;
  END IF;
  SELECT id, kg_on_hand INTO v_lot
  FROM public.green_lots
  WHERE id = p_lot_id
  FOR UPDATE;
  IF v_lot.id IS NULL THEN
    RAISE EXCEPTION 'Green lot % no longer exists — re-select a lot', p_lot_id;
  END IF;
  v_take := LEAST(GREATEST(v_lot.kg_on_hand, 0), p_kg);
  INSERT INTO public.green_lot_consumption_log
    (lot_id, roasted_batch_id, kg_consumed, created_by, notes)
  VALUES
    (p_lot_id, p_batch_id, v_take, auth.uid(),
     'Batch ' || left(p_batch_id::text, 8)
       || CASE WHEN v_take < p_kg
               THEN ' — needed ' || round(p_kg, 2) || ' kg, lot only had ' || round(v_take, 2) || ' kg'
               ELSE '' END);
  UPDATE public.green_lots
  SET kg_on_hand = kg_on_hand - v_take,
      updated_at = now()
  WHERE id = p_lot_id;
END;
$$;

REVOKE ALL ON FUNCTION public._consume_green_for_batch(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.mark_batch_roasted(uuid, numeric, uuid, numeric, text);

CREATE FUNCTION public.mark_batch_roasted(
  p_batch_id uuid,
  p_actual_output_kg numeric,
  p_lot_id uuid DEFAULT NULL,
  p_loss_kg numeric DEFAULT 0,
  p_loss_note text DEFAULT NULL,
  p_lot_splits jsonb DEFAULT NULL,
  p_green_kg numeric DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
  v_enabled boolean;
  v_loss_pct numeric;
  v_green_kg numeric;
  v_total_pct numeric;
  v_split RECORD;
BEGIN
  PERFORM public._assert_internal_staff();
  IF p_actual_output_kg IS NULL OR p_actual_output_kg < 0 THEN
    RAISE EXCEPTION 'Output kg must be >= 0';
  END IF;
  SELECT id, status, roast_group, planned_output_kg INTO v_batch
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
  SET status = 'ROASTED', actual_output_kg = p_actual_output_kg, roasted_at = now()
  WHERE id = p_batch_id;
  INSERT INTO public.inventory_transactions
    (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
  VALUES
    ('ROAST_OUTPUT', v_batch.roast_group, p_actual_output_kg, true, auth.uid(),
     'Batch ' || left(p_batch_id::text, 8), p_batch_id);
  IF COALESCE(p_loss_kg, 0) > 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
    VALUES
      ('LOSS', v_batch.roast_group, -p_loss_kg, false, auth.uid(), p_loss_note, p_batch_id);
  END IF;

  SELECT COALESCE((value_json->>'enabled')::boolean, false) INTO v_enabled
  FROM public.app_settings WHERE key = 'green_deduction';
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN true;
  END IF;

  SELECT expected_yield_loss_pct INTO v_loss_pct
  FROM public.roast_groups WHERE roast_group = v_batch.roast_group;
  v_green_kg := CASE
    WHEN p_green_kg > 0 THEN p_green_kg
    WHEN v_batch.planned_output_kg > 0 THEN v_batch.planned_output_kg
    ELSE public.green_kg_for_roasted(p_actual_output_kg, COALESCE(v_loss_pct, 16))
  END;

  IF p_lot_splits IS NOT NULL AND jsonb_typeof(p_lot_splits) = 'array' AND jsonb_array_length(p_lot_splits) > 0 THEN
    SELECT COALESCE(SUM(GREATEST(COALESCE((e->>'pct')::numeric, 0), 0)), 0) INTO v_total_pct
    FROM jsonb_array_elements(p_lot_splits) e;
    IF v_total_pct > 0 THEN
      FOR v_split IN
        SELECT (e->>'lot_id')::uuid AS lot_id, GREATEST(COALESCE((e->>'pct')::numeric, 0), 0) AS pct
        FROM jsonb_array_elements(p_lot_splits) e
      LOOP
        IF v_split.pct > 0 THEN
          PERFORM public._consume_green_for_batch(v_split.lot_id, p_batch_id, v_green_kg * v_split.pct / v_total_pct);
        END IF;
      END LOOP;
    END IF;
  ELSIF p_lot_id IS NOT NULL THEN
    PERFORM public._consume_green_for_batch(p_lot_id, p_batch_id, v_green_kg);
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_batch_roasted(uuid, numeric, uuid, numeric, text, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_batch_roasted(uuid, numeric, uuid, numeric, text, jsonb, numeric) TO authenticated, service_role;

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
  v_use RECORD;
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
  SET status = 'PLANNED', roasted_at = NULL
  WHERE id = p_batch_id;
  IF v_batch.actual_output_kg <> 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
    VALUES
      ('ADJUSTMENT', v_batch.roast_group, -v_batch.actual_output_kg, true, auth.uid(),
       'Reverted batch ' || left(p_batch_id::text, 8) || ' to planned', p_batch_id);
  END IF;

  FOR v_use IN
    SELECT lot_id, SUM(kg_consumed) AS kg
    FROM public.green_lot_consumption_log
    WHERE roasted_batch_id = p_batch_id
    GROUP BY lot_id
  LOOP
    UPDATE public.green_lots
    SET kg_on_hand = kg_on_hand + v_use.kg,
        updated_at = now()
    WHERE id = v_use.lot_id;
  END LOOP;
  DELETE FROM public.green_lot_consumption_log WHERE roasted_batch_id = p_batch_id;

  RETURN true;
END;
$$;

NOTIFY pgrst, 'reload schema';