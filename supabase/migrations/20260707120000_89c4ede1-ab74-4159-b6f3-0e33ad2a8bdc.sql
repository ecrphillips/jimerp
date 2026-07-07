-- Atomic ship-pick and cancel-with-picks RPCs
--
-- Replaces two client-side multi-step write sequences that could double-count or
-- diverge the finished-goods (FG) ledger:
--
--   * set_ship_pick — the Ship tab previously (a) upserted ship_picks to an
--     absolute value, then (b) inserted a SHIP_CONSUME_FG row for a delta computed
--     from a browser cache that could be up to 10s stale. Two pickers on the same
--     line (or one double-click before refetch) both computed the delta from the
--     same baseline, so the ledger recorded the consumption twice while ship_picks
--     recorded it once — FG permanently understated. A failed ledger insert after a
--     successful pick upsert left the two divergent with no rollback.
--
--   * cancel_order_with_picks — cancelling an order with picks previously inserted
--     the FG-return/write-off ledger rows, zeroed the picks, and set status =
--     CANCELLED as three separate calls. A failure between steps left FG credited
--     while the order stayed live (a retry then found the picks already zeroed and
--     cancelled "clean", leaving FG inflated).
--
-- Both functions compute the delta / read the picks server-side under lock, so the
-- write is atomic and immune to the stale-baseline race. They mirror the existing
-- update_packing_units pattern (20260611090000_inventory_atomic_rpcs.sql) and reuse
-- public._assert_internal_staff() for the ADMIN/OPS gate.

-- ============================================================
-- 1) set_ship_pick
--    Atomically set a line item's picked units and write the
--    matching SHIP_CONSUME_FG delta. The previous pick count is
--    read under lock so concurrent updates cannot lose deltas.
--    requires_production and order status are resolved server-side
--    (authoritative), not trusted from the client. Returns the new
--    picked count.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_ship_pick(
  p_order_id uuid,
  p_order_line_item_id uuid,
  p_units_picked integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_previous_units integer := 0;
  v_delta integer;
  v_status public.order_status;
  v_order_number text;
  v_product_id uuid;
  v_requires_production boolean;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_units_picked IS NULL OR p_units_picked < 0 THEN
    RAISE EXCEPTION 'Picked units must be >= 0';
  END IF;

  -- Resolve the order and the line item's product server-side.
  SELECT status, order_number INTO v_status, v_order_number
  FROM public.orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;

  SELECT oli.product_id, COALESCE(p.requires_production, true)
  INTO v_product_id, v_requires_production
  FROM public.order_line_items oli
  JOIN public.products p ON p.id = oli.product_id
  WHERE oli.id = p_order_line_item_id AND oli.order_id = p_order_id;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Line item % not found on order %', p_order_line_item_id, p_order_id;
  END IF;

  -- Serialize concurrent updates to the same line item so the read-modify-write
  -- of ship_picks + ledger cannot interleave.
  PERFORM pg_advisory_xact_lock(hashtext('ship_pick:' || p_order_line_item_id::text));

  SELECT units_picked INTO v_previous_units
  FROM public.ship_picks
  WHERE order_line_item_id = p_order_line_item_id
  FOR UPDATE;

  v_previous_units := COALESCE(v_previous_units, 0);
  v_delta := p_units_picked - v_previous_units;

  INSERT INTO public.ship_picks (order_id, order_line_item_id, units_picked, updated_by)
  VALUES (p_order_id, p_order_line_item_id, p_units_picked, auth.uid())
  ON CONFLICT (order_line_item_id) DO UPDATE
  SET units_picked = EXCLUDED.units_picked,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  -- Once SHIPPED the FG consumption already happened at pick time and shipping
  -- doesn't re-consume; freeze the ledger so an unpick can't re-add shipped stock.
  -- Bought-in items (requires_production = false) never touch the FG ledger.
  IF v_delta <> 0 AND v_requires_production AND v_status <> 'SHIPPED' THEN
    INSERT INTO public.inventory_transactions
      (transaction_type, product_id, order_id, quantity_units, is_system_generated, created_by, notes)
    VALUES
      ('SHIP_CONSUME_FG', v_product_id, p_order_id, -v_delta, true, auth.uid(),
       CASE WHEN v_delta > 0
         THEN 'Picked ' || v_delta || ' units for order ' || COALESCE(v_order_number, p_order_id::text)
         ELSE 'Returned ' || abs(v_delta) || ' units from order ' || COALESCE(v_order_number, p_order_id::text)
       END);
  END IF;

  RETURN p_units_picked;
END;
$$;

-- ============================================================
-- 2) cancel_order_with_picks
--    Atomically reverse a cancelled order's picks and set status.
--    Picks are read server-side (source of truth). p_mode:
--      'return'   → each pick's FG re-enters stock (SHIP_CONSUME_FG +units)
--      'writeoff' → FG re-enters then leaves as a recorded loss (ADJUSTMENT -units)
--    Only requires_production products touch the FG ledger (matching how the
--    pick consumption was written); bought-in picks are simply zeroed. The status
--    change is delegated to update_order_status so transition validation and the
--    audit-log row happen exactly as on every other status change.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_order_with_picks(
  p_order_id uuid,
  p_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_number text;
  v_pick RECORD;
BEGIN
  PERFORM public._assert_internal_staff();

  IF p_mode NOT IN ('return', 'writeoff') THEN
    RAISE EXCEPTION 'Invalid cancel mode: %', p_mode;
  END IF;

  SELECT order_number INTO v_order_number FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;

  -- Reverse each outstanding pick. Lock the rows so a concurrent pick edit can't
  -- change units between the read and the zero-out.
  FOR v_pick IN
    SELECT sp.id, sp.units_picked, oli.product_id, COALESCE(p.requires_production, true) AS requires_production
    FROM public.ship_picks sp
    JOIN public.order_line_items oli ON oli.id = sp.order_line_item_id
    JOIN public.products p ON p.id = oli.product_id
    WHERE sp.order_id = p_order_id AND sp.units_picked > 0
    FOR UPDATE OF sp
  LOOP
    IF v_pick.requires_production THEN
      -- Reverse the pick consumption — the coffee re-enters FG.
      INSERT INTO public.inventory_transactions
        (transaction_type, product_id, order_id, quantity_units, is_system_generated, created_by, notes)
      VALUES
        ('SHIP_CONSUME_FG', v_pick.product_id, p_order_id, v_pick.units_picked, false, auth.uid(),
         CASE WHEN p_mode = 'return'
           THEN 'Returned ' || v_pick.units_picked || ' units to stock (order ' || COALESCE(v_order_number, p_order_id::text) || ' cancelled)'
           ELSE 'Reversed ' || v_pick.units_picked || ' picked units (order ' || COALESCE(v_order_number, p_order_id::text) || ' cancelled)'
         END);

      -- Write-off: immediately remove it again as a recorded loss.
      IF p_mode = 'writeoff' THEN
        INSERT INTO public.inventory_transactions
          (transaction_type, product_id, order_id, quantity_units, is_system_generated, created_by, notes)
        VALUES
          ('ADJUSTMENT', v_pick.product_id, p_order_id, -v_pick.units_picked, false, auth.uid(),
           'Written off as lost: ' || v_pick.units_picked || ' units (order ' || COALESCE(v_order_number, p_order_id::text) || ' cancelled)');
      END IF;
    END IF;

    UPDATE public.ship_picks
    SET units_picked = 0, updated_by = auth.uid(), updated_at = now()
    WHERE id = v_pick.id;
  END LOOP;

  -- Delegate the status change (transition validation + audit log + shipped flag).
  PERFORM public.update_order_status(p_order_id, 'CANCELLED'::public.order_status, NULL, false, 'Cancelled with pick reversal');
END;
$$;

-- ============================================================
-- Grants: authenticated only; functions enforce role internally
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.set_ship_pick(uuid, uuid, integer)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_order_with_picks(uuid, text)         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_ship_pick(uuid, uuid, integer)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_with_picks(uuid, text)          TO authenticated;
