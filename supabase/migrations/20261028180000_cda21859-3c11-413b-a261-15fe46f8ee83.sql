-- Roast batch numbers, WIP bin labels and batch history.
--
-- Batch numbers: <machine code>-<MMDD>-<daily seq>, e.g. L15-1028-03.
--   Loring = L15, Samiac = S30, post-roast blends = BL, no machine = XX.
--   Given the moment a batch becomes ROASTED (by any path: the Roast tab,
--   Oh Shit, anything else) by a trigger, counted per machine per Vancouver
--   day through batch_number_counters (row-locked upsert, so two people
--   saving at once never get the same number). Once given, a number stays
--   with the batch (undo + re-roast keeps it). Only edit_roasted_batch
--   (ADMIN) can change it.
--
-- Green: marking roasted always records the green kg in and the lot split on
--   the batch; when app_settings 'green_deduction' is on it also takes that
--   green off the lots (allowed to go negative) and flags green_deducted.
--   Undo and admin edits put back / re-take exactly what the log says.
--
-- Blends: execute_blend now creates a blend_runs row with a BL number and
--   records each component batch in blend_run_components.
--
-- Safety: roasted / numbered batches can no longer be deleted (undo first),
--   and the "purge ghost production rows" tool no longer deletes batches
--   (wip_ledger is empty, so it was deleting all of them).

-- ---------------------------------------------------------------------------
-- 1. Columns and tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.roasted_batches
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS batch_date date,
  ADD COLUMN IF NOT EXISTS batch_seq integer,
  ADD COLUMN IF NOT EXISTS roasted_by uuid,
  ADD COLUMN IF NOT EXISTS green_lot_splits jsonb,
  ADD COLUMN IF NOT EXISTS green_deducted boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS roasted_batches_batch_number_key
  ON public.roasted_batches (batch_number) WHERE batch_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS roasted_batches_roasted_at_idx
  ON public.roasted_batches (roasted_at DESC);

-- Short name printed on labels (e.g. "Chris"). Falls back to the first word of name.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS label_name text;

CREATE TABLE IF NOT EXISTS public.batch_number_counters (
  machine_code text NOT NULL,
  batch_date date NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (machine_code, batch_date)
);
ALTER TABLE public.batch_number_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can read batch number counters" ON public.batch_number_counters;
CREATE POLICY "Staff can read batch number counters" ON public.batch_number_counters
  FOR SELECT USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

CREATE TABLE IF NOT EXISTS public.blend_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text NOT NULL UNIQUE,
  batch_date date NOT NULL,
  batch_seq integer,
  blend_roast_group text NOT NULL,
  total_kg numeric NOT NULL,
  made_by uuid,
  made_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blend_runs_made_at_idx ON public.blend_runs (made_at DESC);

CREATE TABLE IF NOT EXISTS public.blend_run_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blend_run_id uuid NOT NULL REFERENCES public.blend_runs(id) ON DELETE CASCADE,
  roasted_batch_id uuid NOT NULL REFERENCES public.roasted_batches(id) ON DELETE CASCADE,
  kg_used numeric NOT NULL,
  UNIQUE (blend_run_id, roasted_batch_id)
);
CREATE INDEX IF NOT EXISTS blend_run_components_batch_idx ON public.blend_run_components (roasted_batch_id);

ALTER TABLE public.blend_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blend_run_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can read blend runs" ON public.blend_runs;
CREATE POLICY "Staff can read blend runs" ON public.blend_runs
  FOR SELECT USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));
DROP POLICY IF EXISTS "Admins can edit blend runs" ON public.blend_runs;
CREATE POLICY "Admins can edit blend runs" ON public.blend_runs
  FOR UPDATE USING (has_role(auth.uid(), 'ADMIN'::app_role))
  WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));
DROP POLICY IF EXISTS "Staff can read blend run components" ON public.blend_run_components;
CREATE POLICY "Staff can read blend run components" ON public.blend_run_components
  FOR SELECT USING (has_role(auth.uid(), 'ADMIN'::app_role) OR has_role(auth.uid(), 'OPS'::app_role));

-- ---------------------------------------------------------------------------
-- 2. Number helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.batch_machine_code(p_machine text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE p_machine
    WHEN 'LORING' THEN 'L15'
    WHEN 'SAMIAC' THEN 'S30'
    WHEN 'BLEND'  THEN 'BL'
    ELSE 'XX'
  END;
$$;

CREATE OR REPLACE FUNCTION public.format_batch_number(p_code text, p_date date, p_seq integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT p_code || '-' || to_char(p_date, 'MMDD') || '-' || lpad(p_seq::text, 2, '0');
$$;

-- Next free number for a machine and day. The upsert row-locks the counter,
-- so concurrent callers queue and each gets its own sequence.
CREATE OR REPLACE FUNCTION public._next_batch_number(
  p_code text, p_date date, OUT batch_number text, OUT batch_seq integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  LOOP
    INSERT INTO public.batch_number_counters AS c (machine_code, batch_date, last_seq)
    VALUES (p_code, p_date, 1)
    ON CONFLICT (machine_code, batch_date) DO UPDATE SET last_seq = c.last_seq + 1
    RETURNING c.last_seq INTO batch_seq;
    batch_number := public.format_batch_number(p_code, p_date, batch_seq);
    -- Skip numbers an admin has already typed in by hand.
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.roasted_batches rb WHERE rb.batch_number = _next_batch_number.batch_number)
          AND NOT EXISTS (SELECT 1 FROM public.blend_runs br WHERE br.batch_number = _next_batch_number.batch_number);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._next_batch_number(text, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backfill existing ROASTED batches (before the triggers exist)
-- ---------------------------------------------------------------------------
-- Ted, 2026-10-28: the roasted batches with no machine recorded were all on the Samiac.
UPDATE public.roasted_batches
SET assigned_roaster = 'SAMIAC'
WHERE status = 'ROASTED' AND assigned_roaster IS NULL;

-- Who roasted: the person who created the batch's ROAST_OUTPUT ledger row.
UPDATE public.roasted_batches b
SET roasted_by = t.created_by
FROM (
  SELECT DISTINCT ON (source_batch_id) source_batch_id, created_by
  FROM public.inventory_transactions
  WHERE transaction_type = 'ROAST_OUTPUT' AND source_batch_id IS NOT NULL
  ORDER BY source_batch_id, created_at
) t
WHERE t.source_batch_id = b.id AND b.roasted_by IS NULL;

-- Green kg in for history (no green consumption is backfilled).
WITH ranked AS (
  SELECT id, code, d,
         row_number() OVER (PARTITION BY code, d ORDER BY ts, id) AS seq
  FROM (
    SELECT id,
           public.batch_machine_code(assigned_roaster::text) AS code,
           (COALESCE(roasted_at, updated_at) AT TIME ZONE 'America/Vancouver')::date AS d,
           COALESCE(roasted_at, updated_at) AS ts
    FROM public.roasted_batches
    WHERE status = 'ROASTED' AND batch_number IS NULL
  ) x
)
UPDATE public.roasted_batches b
SET batch_date = r.d,
    batch_seq = r.seq,
    batch_number = public.format_batch_number(r.code, r.d, r.seq::int)
FROM ranked r
WHERE r.id = b.id;

INSERT INTO public.batch_number_counters (machine_code, batch_date, last_seq)
SELECT split_part(batch_number, '-', 1), batch_date, max(batch_seq)
FROM public.roasted_batches
WHERE batch_number IS NOT NULL
GROUP BY 1, 2
ON CONFLICT (machine_code, batch_date) DO UPDATE
  SET last_seq = GREATEST(public.batch_number_counters.last_seq, EXCLUDED.last_seq);

-- Label names for current staff.
UPDATE public.profiles SET label_name = 'Chris' WHERE email = 'chris@homeislandcoffee.com' AND label_name IS NULL;
UPDATE public.profiles SET label_name = 'Laura' WHERE email = 'laura@homeislandcoffee.com' AND label_name IS NULL;
UPDATE public.profiles SET label_name = 'Ted'   WHERE email = 'ted@homeislandcoffee.com'   AND label_name IS NULL;
UPDATE public.profiles SET label_name = 'Aaron' WHERE email = 'aaron@homeislandcoffee.com' AND label_name IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Triggers: number on roast, protect numbers, block deleting roasted batches
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.roasted_batches_numbering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next RECORD;
BEGIN
  -- A number never changes except through edit_roasted_batch (ADMIN).
  IF TG_OP = 'UPDATE'
     AND OLD.batch_number IS NOT NULL
     AND NEW.batch_number IS DISTINCT FROM OLD.batch_number
     AND COALESCE(current_setting('jim.batch_edit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Batch numbers can only be changed from Batch History (admin).';
  END IF;

  IF NEW.status = 'ROASTED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ROASTED') THEN
    NEW.roasted_at := COALESCE(NEW.roasted_at, now());
    NEW.roasted_by := COALESCE(auth.uid(), NEW.roasted_by);
    IF NEW.batch_number IS NULL THEN
      NEW.batch_date := (NEW.roasted_at AT TIME ZONE 'America/Vancouver')::date;
      SELECT * INTO v_next
      FROM public._next_batch_number(public.batch_machine_code(NEW.assigned_roaster::text), NEW.batch_date);
      NEW.batch_number := v_next.batch_number;
      NEW.batch_seq := v_next.batch_seq;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roasted_batches_numbering ON public.roasted_batches;
CREATE TRIGGER trg_roasted_batches_numbering
  BEFORE INSERT OR UPDATE ON public.roasted_batches
  FOR EACH ROW EXECUTE FUNCTION public.roasted_batches_numbering();

CREATE OR REPLACE FUNCTION public.roasted_batches_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (OLD.status = 'ROASTED' OR OLD.batch_number IS NOT NULL)
     AND COALESCE(current_setting('jim.allow_batch_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Roasted batches can''t be deleted (batch %). Undo it instead.', COALESCE(OLD.batch_number, left(OLD.id::text, 8));
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_roasted_batches_block_delete ON public.roasted_batches;
CREATE TRIGGER trg_roasted_batches_block_delete
  BEFORE DELETE ON public.roasted_batches
  FOR EACH ROW EXECUTE FUNCTION public.roasted_batches_block_delete();

-- The dev "reset test day" tool still wipes everything on purpose.
CREATE OR REPLACE FUNCTION public.dev_reset_test_day()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;
  PERFORM set_config('jim.allow_batch_delete', 'on', true);
  RETURN public.dev_test_reset();
END;
$function$;

-- Purge no longer touches roasted batches (wip_ledger is retired and empty,
-- so the old check matched every batch).
CREATE OR REPLACE FUNCTION public.dev_purge_ghost_production_rows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_rows   integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  DELETE FROM public.ship_picks sp
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fg_inventory_log fil
    JOIN public.order_line_items oli ON oli.id = sp.order_line_item_id
    WHERE fil.product_id = oli.product_id
      AND fil.created_at BETWEEN sp.updated_at - interval '2 hours'
                             AND sp.updated_at + interval '2 hours'
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('ship_picks', v_rows);

  DELETE FROM public.packing_runs pr
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fg_inventory_log fil
    WHERE fil.product_id = pr.product_id
      AND fil.created_at BETWEEN pr.created_at - interval '2 hours'
                             AND pr.created_at + interval '2 hours'
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('packing_runs', v_rows);

  v_counts := v_counts || jsonb_build_object('roasted_batches', 0);
  RETURN v_counts;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Green helpers (no cap: green may go negative, never blocks the roaster)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._consume_green_for_batch(p_lot_id uuid, p_batch_id uuid, p_kg numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lot_id uuid;
  v_label text;
BEGIN
  IF p_kg IS NULL OR p_kg <= 0 THEN
    RETURN;
  END IF;
  SELECT id INTO v_lot_id FROM public.green_lots WHERE id = p_lot_id FOR UPDATE;
  IF v_lot_id IS NULL THEN
    RAISE EXCEPTION 'Green lot % no longer exists — re-select a lot', p_lot_id;
  END IF;
  SELECT COALESCE(batch_number, left(id::text, 8)) INTO v_label FROM public.roasted_batches WHERE id = p_batch_id;
  INSERT INTO public.green_lot_consumption_log (lot_id, roasted_batch_id, kg_consumed, created_by, notes)
  VALUES (p_lot_id, p_batch_id, p_kg, auth.uid(), 'Batch ' || COALESCE(v_label, left(p_batch_id::text, 8)));
  UPDATE public.green_lots
  SET kg_on_hand = kg_on_hand - p_kg, updated_at = now()
  WHERE id = p_lot_id;
END;
$$;
REVOKE ALL ON FUNCTION public._consume_green_for_batch(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

-- Take the batch's green (planned_output_kg) off its recorded split.
CREATE OR REPLACE FUNCTION public._apply_batch_green(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
  v_total numeric;
  v_split RECORD;
BEGIN
  SELECT id, planned_output_kg, green_lot_splits INTO v_batch
  FROM public.roasted_batches WHERE id = p_batch_id;
  IF v_batch.id IS NULL OR COALESCE(v_batch.planned_output_kg, 0) <= 0
     OR v_batch.green_lot_splits IS NULL OR jsonb_typeof(v_batch.green_lot_splits) <> 'array' THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(GREATEST(COALESCE((e->>'pct')::numeric, 0), 0)), 0) INTO v_total
  FROM jsonb_array_elements(v_batch.green_lot_splits) e;
  IF v_total <= 0 THEN
    RETURN;
  END IF;
  FOR v_split IN
    SELECT (e->>'lot_id')::uuid AS lot_id, GREATEST(COALESCE((e->>'pct')::numeric, 0), 0) AS pct
    FROM jsonb_array_elements(v_batch.green_lot_splits) e
  LOOP
    IF v_split.pct > 0 THEN
      PERFORM public._consume_green_for_batch(v_split.lot_id, p_batch_id, v_batch.planned_output_kg * v_split.pct / v_total);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._apply_batch_green(uuid) FROM PUBLIC, anon, authenticated;

-- Put back everything the log says this batch took, and clear the log rows.
CREATE OR REPLACE FUNCTION public._restore_batch_green(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_use RECORD;
BEGIN
  FOR v_use IN
    SELECT lot_id, SUM(kg_consumed) AS kg
    FROM public.green_lot_consumption_log
    WHERE roasted_batch_id = p_batch_id
    GROUP BY lot_id
  LOOP
    UPDATE public.green_lots
    SET kg_on_hand = kg_on_hand + v_use.kg, updated_at = now()
    WHERE id = v_use.lot_id;
  END LOOP;
  DELETE FROM public.green_lot_consumption_log WHERE roasted_batch_id = p_batch_id;
END;
$$;
REVOKE ALL ON FUNCTION public._restore_batch_green(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Mark roasted (now returns the batch number) / undo / admin edit
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mark_batch_roasted(uuid, numeric, uuid, numeric, text, jsonb, numeric);

CREATE FUNCTION public.mark_batch_roasted(
  p_batch_id uuid,
  p_actual_output_kg numeric,
  p_lot_id uuid DEFAULT NULL,
  p_loss_kg numeric DEFAULT 0,
  p_loss_note text DEFAULT NULL,
  p_lot_splits jsonb DEFAULT NULL,
  p_green_kg numeric DEFAULT NULL,
  p_machine text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
  v_enabled boolean;
  v_loss_pct numeric;
  v_green_kg numeric;
  v_splits jsonb;
  v_number text;
BEGIN
  PERFORM public._assert_internal_staff();
  IF p_actual_output_kg IS NULL OR p_actual_output_kg < 0 THEN
    RAISE EXCEPTION 'Output kg must be >= 0';
  END IF;
  IF p_machine IS NOT NULL AND p_machine NOT IN ('LORING', 'SAMIAC') THEN
    RAISE EXCEPTION 'Unknown machine %', p_machine;
  END IF;

  SELECT id, status, roast_group, planned_output_kg, batch_number INTO v_batch
  FROM public.roasted_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;
  IF v_batch.status <> 'PLANNED' THEN
    RETURN jsonb_build_object('ok', false, 'batch_id', p_batch_id, 'batch_number', v_batch.batch_number);
  END IF;

  SELECT expected_yield_loss_pct INTO v_loss_pct
  FROM public.roast_groups WHERE roast_group = v_batch.roast_group;
  v_green_kg := CASE
    WHEN p_green_kg > 0 THEN p_green_kg
    WHEN v_batch.planned_output_kg > 0 THEN v_batch.planned_output_kg
    ELSE public.green_kg_for_roasted(p_actual_output_kg, COALESCE(v_loss_pct, 16))
  END;

  IF p_lot_splits IS NOT NULL AND jsonb_typeof(p_lot_splits) = 'array' AND jsonb_array_length(p_lot_splits) > 0 THEN
    v_splits := p_lot_splits;
  ELSIF p_lot_id IS NOT NULL THEN
    v_splits := jsonb_build_array(jsonb_build_object('lot_id', p_lot_id, 'pct', 100));
  ELSE
    v_splits := NULL;
  END IF;

  UPDATE public.roasted_batches
  SET status = 'ROASTED',
      actual_output_kg = p_actual_output_kg,
      planned_output_kg = v_green_kg,
      assigned_roaster = COALESCE(p_machine::roaster_machine, assigned_roaster),
      green_lot_splits = v_splits,
      roasted_at = now(),
      roasted_by = auth.uid()
  WHERE id = p_batch_id
  RETURNING batch_number INTO v_number;

  INSERT INTO public.inventory_transactions
    (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
  VALUES
    ('ROAST_OUTPUT', v_batch.roast_group, p_actual_output_kg, true, auth.uid(), 'Batch ' || v_number, p_batch_id);
  IF COALESCE(p_loss_kg, 0) > 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
    VALUES
      ('LOSS', v_batch.roast_group, -p_loss_kg, false, auth.uid(), p_loss_note, p_batch_id);
  END IF;

  SELECT COALESCE((value_json->>'enabled')::boolean, false) INTO v_enabled
  FROM public.app_settings WHERE key = 'green_deduction';
  IF COALESCE(v_enabled, false) THEN
    PERFORM public._apply_batch_green(p_batch_id);
    UPDATE public.roasted_batches SET green_deducted = true WHERE id = p_batch_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'batch_number', v_number);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_batch_roasted(uuid, numeric, uuid, numeric, text, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_batch_roasted(uuid, numeric, uuid, numeric, text, jsonb, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revert_batch_to_planned(p_batch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
BEGIN
  PERFORM public._assert_internal_staff();
  SELECT id, status, roast_group, actual_output_kg, consumed_by_blend_at, batch_number INTO v_batch
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
  -- The batch number stays with the batch; re-roasting reuses it.
  UPDATE public.roasted_batches
  SET status = 'PLANNED', roasted_at = NULL, green_deducted = false
  WHERE id = p_batch_id;
  IF v_batch.actual_output_kg <> 0 THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
    VALUES
      ('ADJUSTMENT', v_batch.roast_group, -v_batch.actual_output_kg, true, auth.uid(),
       'Reverted batch ' || COALESCE(v_batch.batch_number, left(p_batch_id::text, 8)) || ' to planned', p_batch_id);
  END IF;
  PERFORM public._restore_batch_green(p_batch_id);
  RETURN true;
END;
$$;

-- Admin edit of a roasted batch. Every field is editable; stock follows:
--   roasted kg change → ADJUSTMENT for the difference (blocked once blended);
--   green kg / lots change on a batch that took green → put back, take again.
CREATE OR REPLACE FUNCTION public.edit_roasted_batch(
  p_batch_id uuid,
  p_batch_number text,
  p_batch_date date,
  p_machine text,
  p_roasted_at timestamptz,
  p_roasted_by uuid,
  p_green_kg numeric,
  p_actual_output_kg numeric,
  p_lot_splits jsonb,
  p_notes text,
  p_cropster_batch_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch RECORD;
  v_number text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Only admins can edit roasted batches' USING ERRCODE = '42501';
  END IF;
  IF p_actual_output_kg IS NULL OR p_actual_output_kg < 0 THEN
    RAISE EXCEPTION 'Roasted kg must be >= 0';
  END IF;
  IF p_green_kg IS NULL OR p_green_kg < 0 THEN
    RAISE EXCEPTION 'Green kg must be >= 0';
  END IF;
  IF p_machine IS NOT NULL AND p_machine NOT IN ('LORING', 'SAMIAC') THEN
    RAISE EXCEPTION 'Unknown machine %', p_machine;
  END IF;
  v_number := NULLIF(upper(trim(p_batch_number)), '');
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Batch number is required';
  END IF;

  SELECT * INTO v_batch FROM public.roasted_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;
  IF v_batch.status <> 'ROASTED' THEN
    RAISE EXCEPTION 'Only roasted batches can be edited here';
  END IF;
  IF EXISTS (SELECT 1 FROM public.blend_runs WHERE batch_number = v_number)
     OR EXISTS (SELECT 1 FROM public.roasted_batches WHERE batch_number = v_number AND id <> p_batch_id) THEN
    RAISE EXCEPTION 'Batch number % is already used', v_number;
  END IF;

  IF p_actual_output_kg IS DISTINCT FROM v_batch.actual_output_kg THEN
    IF v_batch.consumed_by_blend_at IS NOT NULL THEN
      RAISE EXCEPTION 'This batch has gone into a blend, so its roasted kg can''t change';
    END IF;
    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
    VALUES
      ('ADJUSTMENT', v_batch.roast_group, p_actual_output_kg - v_batch.actual_output_kg, true, auth.uid(),
       'Edited batch ' || v_number || ': roasted ' || round(v_batch.actual_output_kg, 2) || ' → ' || round(p_actual_output_kg, 2) || ' kg',
       p_batch_id);
  END IF;

  IF v_batch.green_deducted THEN
    PERFORM public._restore_batch_green(p_batch_id);
  END IF;

  PERFORM set_config('jim.batch_edit', 'on', true);
  UPDATE public.roasted_batches
  SET batch_number = v_number,
      batch_date = COALESCE(p_batch_date, batch_date),
      assigned_roaster = p_machine::roaster_machine,
      roasted_at = COALESCE(p_roasted_at, roasted_at),
      roasted_by = p_roasted_by,
      planned_output_kg = p_green_kg,
      actual_output_kg = p_actual_output_kg,
      green_lot_splits = CASE WHEN p_lot_splits IS NOT NULL AND jsonb_typeof(p_lot_splits) = 'array' AND jsonb_array_length(p_lot_splits) > 0 THEN p_lot_splits END,
      notes = p_notes,
      cropster_batch_id = p_cropster_batch_id
  WHERE id = p_batch_id;
  PERFORM set_config('jim.batch_edit', 'off', true);

  IF v_batch.green_deducted THEN
    PERFORM public._apply_batch_green(p_batch_id);
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_roasted_batch(uuid, text, date, text, timestamptz, uuid, numeric, numeric, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_roasted_batch(uuid, text, date, text, timestamptz, uuid, numeric, numeric, jsonb, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Blends get a BL number and a record of their component batches
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.execute_blend(text, text, uuid[], numeric[]);

CREATE FUNCTION public.execute_blend(
  p_blend_roast_group text,
  p_blend_display_name text,
  p_batch_ids uuid[],
  p_consume_kgs numeric[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
  v_locked_count int;
  v_batch RECORD;
  v_next RECORD;
  v_date date := (now() AT TIME ZONE 'America/Vancouver')::date;
  v_run_id uuid;
  i int;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_batch_ids IS NULL OR array_length(p_batch_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No batches selected';
  END IF;
  IF array_length(p_batch_ids, 1) <> array_length(p_consume_kgs, 1) THEN
    RAISE EXCEPTION 'Batch ids and consume kgs must have the same length';
  END IF;

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

  SELECT * INTO v_next FROM public._next_batch_number('BL', v_date);
  INSERT INTO public.blend_runs (batch_number, batch_date, batch_seq, blend_roast_group, total_kg, made_by)
  VALUES (v_next.batch_number, v_date, v_next.batch_seq, p_blend_roast_group, 0, auth.uid())
  RETURNING id INTO v_run_id;

  UPDATE public.roasted_batches
  SET consumed_by_blend_at = now()
  WHERE id = ANY (p_batch_ids);

  FOR i IN 1 .. array_length(p_batch_ids, 1) LOOP
    IF p_consume_kgs[i] IS NULL OR p_consume_kgs[i] <= 0 THEN
      RAISE EXCEPTION 'Consume kg must be positive for batch %', p_batch_ids[i];
    END IF;

    SELECT id, roast_group, actual_output_kg, batch_number INTO v_batch
    FROM public.roasted_batches
    WHERE id = p_batch_ids[i];

    IF p_consume_kgs[i] > v_batch.actual_output_kg + 0.001 THEN
      RAISE EXCEPTION 'Cannot consume % kg from batch % (output % kg)',
        round(p_consume_kgs[i], 2), COALESCE(v_batch.batch_number, p_batch_ids[i]::text), round(v_batch.actual_output_kg, 2);
    END IF;

    v_total := v_total + p_consume_kgs[i];

    INSERT INTO public.blend_run_components (blend_run_id, roasted_batch_id, kg_used)
    VALUES (v_run_id, p_batch_ids[i], p_consume_kgs[i]);

    INSERT INTO public.inventory_transactions
      (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes, source_batch_id)
    VALUES
      ('BLEND', v_batch.roast_group, -p_consume_kgs[i], true, auth.uid(),
       'Blended into ' || p_blend_display_name || ' ' || v_next.batch_number
         || ' (batch ' || COALESCE(v_batch.batch_number, left(p_batch_ids[i]::text, 8)) || ')',
       p_batch_ids[i]);
  END LOOP;

  UPDATE public.blend_runs SET total_kg = v_total WHERE id = v_run_id;

  INSERT INTO public.inventory_transactions
    (transaction_type, roast_group, quantity_kg, is_system_generated, created_by, notes)
  VALUES
    ('BLEND', p_blend_roast_group, v_total, true, auth.uid(),
     'Created blend ' || v_next.batch_number || ' from ' || array_length(p_batch_ids, 1) || ' component batches');

  RETURN jsonb_build_object('total_kg', v_total, 'blend_run_id', v_run_id, 'batch_number', v_next.batch_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_blend(text, text, uuid[], numeric[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_blend(text, text, uuid[], numeric[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
