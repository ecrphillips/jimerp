-- Populate inventory_transactions.source_batch_id for roast output rows.
--
-- BUG: The Run Sheet → Plan tab "Data orphans" panel detects "ghost batches"
-- by anti-joining roasted_batches against inventory_transactions.source_batch_id
-- (src/components/production/PlanTab.tsx). But NO code ever wrote that column —
-- mark_batch_roasted inserted its ROAST_OUTPUT row without it — so the
-- referenced-set was always empty and EVERY non-PLANNED batch was flagged as a
-- ghost. A prior fix (fabde4f) switched detection onto source_batch_id but never
-- taught the writer to populate it.
--
-- This migration:
--   1. Rewrites mark_batch_roasted to stamp source_batch_id on the ROAST_OUTPUT
--      (and LOSS) rows it emits.
--   2. Rewrites revert_batch_to_planned to stamp source_batch_id on its reversal
--      ADJUSTMENT so the audit trail stays linked.
--   3. Backfills existing ROAST_OUTPUT rows by matching the batch-id prefix in
--      the note text plus the roast_group, so already-roasted batches stop
--      false-flagging as ghosts.
--
-- Function bodies are copied verbatim from
-- 20260615222112_2f7ddff5-0f65-4e73-8f8c-05588a2c6d6f.sql; only the
-- source_batch_id columns/values are added.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) mark_batch_roasted — now stamps source_batch_id
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) revert_batch_to_planned — stamps source_batch_id on the reversal
-- ─────────────────────────────────────────────────────────────────────────────
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
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
    VALUES
      ('ADJUSTMENT', v_batch.roast_group, -v_batch.actual_output_kg, true, auth.uid(),
       'Reverted batch ' || left(p_batch_id::text, 8) || ' to planned', p_batch_id);
  END IF;

  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Backfill historical ROAST_OUTPUT rows
-- ─────────────────────────────────────────────────────────────────────────────
-- mark_batch_roasted has always written the note 'Batch <first 8 hex of id>'.
-- Match on that prefix AND roast_group so the link is effectively collision-free
-- (8 hex chars = 4.3B combos, further constrained by roast_group). Only rows
-- whose prefix resolves to exactly one batch are updated; ambiguous rows are
-- left NULL rather than mislinked.
UPDATE public.inventory_transactions it
SET source_batch_id = rb.id
FROM public.roasted_batches rb
WHERE it.transaction_type = 'ROAST_OUTPUT'
  AND it.source_batch_id IS NULL
  AND it.notes ~ '^Batch [0-9a-f]{8}$'
  AND rb.roast_group = it.roast_group
  AND left(rb.id::text, 8) = substring(it.notes from '^Batch ([0-9a-f]{8})$')
  AND (
    SELECT count(*)
    FROM public.roasted_batches rb2
    WHERE rb2.roast_group = it.roast_group
      AND left(rb2.id::text, 8) = substring(it.notes from '^Batch ([0-9a-f]{8})$')
  ) = 1;
