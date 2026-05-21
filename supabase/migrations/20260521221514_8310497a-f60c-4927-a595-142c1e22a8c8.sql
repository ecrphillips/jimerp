
CREATE TABLE IF NOT EXISTS public.order_status_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status public.order_status,
  to_status public.order_status NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE INDEX IF NOT EXISTS idx_order_status_audit_log_order_id ON public.order_status_audit_log(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_audit_log_changed_at ON public.order_status_audit_log(changed_at DESC);

ALTER TABLE public.order_status_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_status_audit_log read for admin/ops" ON public.order_status_audit_log;
CREATE POLICY "order_status_audit_log read for admin/ops"
  ON public.order_status_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'OPS')
    )
  );

CREATE OR REPLACE FUNCTION public.is_allowed_order_transition(
  p_from public.order_status,
  p_to public.order_status
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_from = p_to THEN false
    WHEN p_from = 'DRAFT'         AND p_to IN ('SUBMITTED', 'CANCELLED') THEN true
    WHEN p_from = 'SUBMITTED'     AND p_to IN ('CONFIRMED', 'CANCELLED', 'DRAFT') THEN true
    WHEN p_from = 'CONFIRMED'     AND p_to IN ('IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED') THEN true
    WHEN p_from = 'IN_PRODUCTION' AND p_to IN ('READY', 'SHIPPED') THEN true
    WHEN p_from = 'READY'         AND p_to IN ('SHIPPED', 'IN_PRODUCTION') THEN true
    WHEN p_from = 'SHIPPED'       AND p_to IN ('CONFIRMED', 'READY') THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_target_status public.order_status,
  p_work_deadline_at timestamptz DEFAULT NULL,
  p_set_deadline boolean DEFAULT false,
  p_reason text DEFAULT NULL
) RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.order_status;
  v_role public.app_role;
  v_updated public.orders;
  v_shipped_clear boolean := false;
BEGIN
  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'OPS') THEN
    RAISE EXCEPTION 'Not authorized to update order status' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_current FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_current <> p_target_status THEN
    IF NOT public.is_allowed_order_transition(v_current, p_target_status) THEN
      RAISE EXCEPTION 'Invalid order status transition: % -> %', v_current, p_target_status USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_current = 'SHIPPED' AND p_target_status <> 'SHIPPED' THEN
    v_shipped_clear := true;
  END IF;

  UPDATE public.orders
  SET
    status = p_target_status,
    work_deadline_at = CASE WHEN p_set_deadline THEN p_work_deadline_at ELSE work_deadline_at END,
    shipped_or_ready = CASE
      WHEN p_target_status = 'SHIPPED' THEN true
      WHEN v_shipped_clear THEN false
      ELSE shipped_or_ready
    END,
    updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  IF v_current <> p_target_status THEN
    INSERT INTO public.order_status_audit_log (order_id, from_status, to_status, changed_by, reason)
    VALUES (p_order_id, v_current, p_target_status, auth.uid(), p_reason);
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_status(uuid, public.order_status, timestamptz, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, public.order_status, timestamptz, boolean, text) TO authenticated;
