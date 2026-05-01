-- Auto-sync trigger: keep green_contracts.status in sync with remaining bags
CREATE OR REPLACE FUNCTION public.sync_contract_depleted_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_contract_ids uuid[];
  v_cid uuid;
  v_num_bags integer;
  v_status contract_status;
  v_requested integer;
  v_remaining integer;
BEGIN
  -- Collect affected contract_ids from NEW and OLD
  IF TG_OP = 'INSERT' THEN
    v_contract_ids := ARRAY[NEW.contract_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_contract_ids := ARRAY[OLD.contract_id];
  ELSE -- UPDATE
    v_contract_ids := ARRAY[NEW.contract_id];
    IF OLD.contract_id IS DISTINCT FROM NEW.contract_id THEN
      v_contract_ids := array_append(v_contract_ids, OLD.contract_id);
    END IF;
  END IF;

  FOREACH v_cid IN ARRAY v_contract_ids LOOP
    IF v_cid IS NULL THEN CONTINUE; END IF;

    SELECT num_bags, status INTO v_num_bags, v_status
      FROM public.green_contracts WHERE id = v_cid;

    IF NOT FOUND OR v_num_bags IS NULL THEN CONTINUE; END IF;

    -- Don't override terminal/manual states like CANCELLED
    IF v_status = 'CANCELLED' THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(rl.bags_requested), 0) INTO v_requested
      FROM public.green_release_lines rl
      JOIN public.green_releases r ON r.id = rl.release_id
      WHERE rl.contract_id = v_cid
        AND r.status <> 'CANCELLED';

    v_remaining := v_num_bags - v_requested;

    IF v_remaining <= 0 AND v_status = 'ACTIVE' THEN
      UPDATE public.green_contracts SET status = 'DEPLETED', updated_at = now() WHERE id = v_cid;
    ELSIF v_remaining > 0 AND v_status = 'DEPLETED' THEN
      UPDATE public.green_contracts SET status = 'ACTIVE', updated_at = now() WHERE id = v_cid;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_contract_depleted_lines ON public.green_release_lines;
CREATE TRIGGER trg_sync_contract_depleted_lines
AFTER INSERT OR UPDATE OR DELETE ON public.green_release_lines
FOR EACH ROW EXECUTE FUNCTION public.sync_contract_depleted_status();

-- Also fire when a release's status flips (e.g. CANCELLED <-> something else)
CREATE OR REPLACE FUNCTION public.sync_contract_depleted_on_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cid uuid;
  v_num_bags integer;
  v_status contract_status;
  v_requested integer;
  v_remaining integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NULL;
  END IF;

  FOR v_cid IN
    SELECT DISTINCT contract_id FROM public.green_release_lines
    WHERE release_id = COALESCE(NEW.id, OLD.id) AND contract_id IS NOT NULL
  LOOP
    SELECT num_bags, status INTO v_num_bags, v_status
      FROM public.green_contracts WHERE id = v_cid;
    IF NOT FOUND OR v_num_bags IS NULL OR v_status = 'CANCELLED' THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(rl.bags_requested), 0) INTO v_requested
      FROM public.green_release_lines rl
      JOIN public.green_releases r ON r.id = rl.release_id
      WHERE rl.contract_id = v_cid AND r.status <> 'CANCELLED';

    v_remaining := v_num_bags - v_requested;

    IF v_remaining <= 0 AND v_status = 'ACTIVE' THEN
      UPDATE public.green_contracts SET status = 'DEPLETED', updated_at = now() WHERE id = v_cid;
    ELSIF v_remaining > 0 AND v_status = 'DEPLETED' THEN
      UPDATE public.green_contracts SET status = 'ACTIVE', updated_at = now() WHERE id = v_cid;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_contract_depleted_release ON public.green_releases;
CREATE TRIGGER trg_sync_contract_depleted_release
AFTER UPDATE OF status ON public.green_releases
FOR EACH ROW EXECUTE FUNCTION public.sync_contract_depleted_on_release();

-- One-time backfill: ACTIVE contracts with 0 remaining bags -> DEPLETED
UPDATE public.green_contracts c
SET status = 'DEPLETED', updated_at = now()
WHERE c.status = 'ACTIVE'
  AND c.num_bags IS NOT NULL
  AND c.num_bags - COALESCE((
    SELECT SUM(rl.bags_requested)
    FROM public.green_release_lines rl
    JOIN public.green_releases r ON r.id = rl.release_id
    WHERE rl.contract_id = c.id AND r.status <> 'CANCELLED'
  ), 0) <= 0;
