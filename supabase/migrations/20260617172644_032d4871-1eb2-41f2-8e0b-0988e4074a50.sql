CREATE OR REPLACE FUNCTION public.dev_purge_ghost_production_rows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_rows   integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'Access denied: ADMIN role required';
  END IF;

  -- Ship picks with no fg_inventory_log reference at all (ghost picks)
  DELETE FROM public.ship_picks sp
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fg_inventory_log fil
    WHERE fil.related_order_line_item_id = sp.order_line_item_id
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('ship_picks', v_rows);

  -- Packing runs with no fg_inventory_log PACK entry referencing them
  DELETE FROM public.packing_runs pr
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fg_inventory_log fil
    WHERE fil.related_packing_run_id = pr.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.wip_ledger wl
    WHERE wl.related_batch_id = pr.related_batch_id
      AND wl.entry_type = 'PACK_CONSUME'
      AND wl.created_at >= pr.created_at - interval '1 hour'
      AND wl.created_at <= pr.created_at + interval '1 hour'
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('packing_runs', v_rows);

  -- Roasted batches with no wip_ledger row referencing them
  DELETE FROM public.roasted_batches rb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.wip_ledger wl
    WHERE wl.related_batch_id = rb.id
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('roasted_batches', v_rows);

  RETURN v_counts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dev_purge_ghost_production_rows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_purge_ghost_production_rows() TO authenticated;