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
    WHEN p_from = 'IN_PRODUCTION' AND p_to IN ('READY', 'SHIPPED')                                            THEN true
    WHEN p_from = 'READY'         AND p_to IN ('SHIPPED', 'IN_PRODUCTION')                                    THEN true
    WHEN p_from = 'SHIPPED'       AND p_to IN ('CONFIRMED', 'READY')                                          THEN true
    ELSE false
  END;
$$;