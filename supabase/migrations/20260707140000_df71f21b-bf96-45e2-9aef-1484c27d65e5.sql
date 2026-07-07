-- Allow SHIPPED -> CANCELLED on the live order-status validator and add the
-- documented cancel_shipped_order RPC. Also drops a broken, orphaned
-- is_valid_status_transition(text, text) that was overwritten directly against
-- the live DB (it referenced a non-existent *_original function). That orphan
-- is dead code -- nothing in the DB or repo calls it; the real validator is
-- is_allowed_order_transition, used by update_order_status.

-- 1. Real validator: exact live definition + SHIPPED -> CANCELLED (only change).
CREATE OR REPLACE FUNCTION public.is_allowed_order_transition(p_from order_status, p_to order_status)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_from = p_to                                                                       THEN true
    WHEN p_from = 'DRAFT'         AND p_to IN ('SUBMITTED', 'CANCELLED')                     THEN true
    WHEN p_from = 'SUBMITTED'     AND p_to IN ('CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED') THEN true
    WHEN p_from = 'CONFIRMED'     AND p_to IN ('IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED')              THEN true
    WHEN p_from = 'IN_PRODUCTION' AND p_to IN ('READY', 'SHIPPED', 'CANCELLED')                               THEN true
    WHEN p_from = 'READY'         AND p_to IN ('SHIPPED', 'IN_PRODUCTION', 'CANCELLED')                       THEN true
    WHEN p_from = 'SHIPPED'       AND p_to IN ('CONFIRMED', 'READY', 'CANCELLED')                             THEN true
    ELSE false
  END;
$function$;

-- 2. cancel_shipped_order: mark a SHIPPED order CANCELLED + audit row, no
--    inventory ledger writes. Mirrors cancel_order_with_picks' SECURITY DEFINER
--    / search_path / _assert_internal_staff pattern, and routes through
--    update_order_status (which writes the order_status_audit_log row and clears
--    shipped_or_ready) -- same as cancel_order_with_picks' final step.
CREATE OR REPLACE FUNCTION public.cancel_shipped_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status public.order_status;
BEGIN
  PERFORM public._assert_internal_staff();

  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'SHIPPED' THEN
    RAISE EXCEPTION 'cancel_shipped_order only cancels SHIPPED orders (order is %)', v_status
      USING ERRCODE = '22023';
  END IF;

  -- Marks CANCELLED, writes order_status_audit_log, clears shipped_or_ready.
  -- No inventory_transactions written (shipped stock stays consumed).
  PERFORM public.update_order_status(
    p_order_id,
    'CANCELLED'::public.order_status,
    NULL,
    false,
    'Cancelled after shipment'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_shipped_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_shipped_order(uuid) TO authenticated;

-- 3. Remove the broken orphan. Its pre-incident body was never in the repo or
--    git history, so it cannot be "restored" -- but it is called by nothing, so
--    dropping it fully resolves the breakage. Delete this statement if you would
--    rather leave the broken function in place.
DROP FUNCTION IF EXISTS public.is_valid_status_transition(text, text);
