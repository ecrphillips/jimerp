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