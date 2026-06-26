-- Cancel is a side-exit from the pipeline, available at ANY active stage.
-- Previously IN_PRODUCTION and READY could not transition to CANCELLED, which
-- blocked the OrderDetail "Cancel order" flow server-side. Allow CANCELLED from
-- every active stage; only SHIPPED and CANCELLED remain terminal/uncancellable.
-- Mirrors src/lib/orderTransitions.ts ALLOWED_ORDER_TRANSITIONS.
--
-- Rebased on 20260617170415 (self-transition -> true, expanded SUBMITTED
-- targets); only the IN_PRODUCTION and READY rows gain CANCELLED.

CREATE OR REPLACE FUNCTION public.is_allowed_order_transition(
  p_from public.order_status,
  p_to   public.order_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_from = p_to                                                                       THEN true
    WHEN p_from = 'DRAFT'         AND p_to IN ('SUBMITTED', 'CANCELLED')                     THEN true
    WHEN p_from = 'SUBMITTED'     AND p_to IN ('CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED') THEN true
    WHEN p_from = 'CONFIRMED'     AND p_to IN ('IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED')              THEN true
    WHEN p_from = 'IN_PRODUCTION' AND p_to IN ('READY', 'SHIPPED', 'CANCELLED')                               THEN true
    WHEN p_from = 'READY'         AND p_to IN ('SHIPPED', 'IN_PRODUCTION', 'CANCELLED')                       THEN true
    WHEN p_from = 'SHIPPED'       AND p_to IN ('CONFIRMED', 'READY')                                          THEN true
    ELSE false
  END;
$$;
