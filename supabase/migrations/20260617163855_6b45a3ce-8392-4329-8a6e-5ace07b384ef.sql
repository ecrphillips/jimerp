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

  -- Lock eligible batches first, then count (FOR UPDATE cannot be combined with aggregates)
  WITH locked AS (
    SELECT id
    FROM public.roasted_batches
    WHERE id = ANY (p_batch_ids)
      AND status = 'ROASTED'
      AND consumed_by_blend_at IS NULL
    FOR UPDATE
  )
  SELECT count(*) INTO v_locked_count FROM locked;

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