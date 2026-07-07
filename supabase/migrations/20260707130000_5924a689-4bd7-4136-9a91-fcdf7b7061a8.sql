-- Hide CANCELLED orders by default, everywhere, at the database layer.
--
-- 1) A RESTRICTIVE SELECT policy on public.orders removes CANCELLED rows from
--    every read made with a user JWT (internal portal, client portal, and any
--    external RLS-scoped reader such as the Home Island MCP tools). Because it
--    is restrictive, it ANDs with all existing permissive policies — no screen
--    needs its own .neq('status','CANCELLED') filter, and future screens are
--    covered automatically.
--
--    Unaffected on purpose:
--      * service_role (edge functions: notify-order-event still reads the
--        cancelled order to send cancellation emails; shopify-pull-orders
--        dedup still sees cancelled orders).
--      * SECURITY DEFINER functions owned by postgres (update_order_status,
--        cancel_order_with_picks, delete_order_safe, ...) — the table owner
--        bypasses RLS, so server-side order logic keeps full visibility.
--
--    Known consequence: rows in tables whose CLIENT-facing policies scope
--    through public.orders (order_line_items, order_shipments,
--    inventory_transactions) also disappear for clients when the parent order
--    is cancelled — desired for customer-facing data. Staff policies on those
--    tables are has_role-based and unaffected. A second consequence: direct
--    PostgREST UPDATE/DELETE against an already-CANCELLED order match zero
--    rows (the WHERE clause needs SELECT visibility); cancelled orders are
--    treated as read-only in the UI, and server-side RPCs remain the path for
--    anything that must touch them.
--
-- 2) public.orders_all — the deliberate opt-in for reads that must still see
--    cancelled orders. Staff-only (ADMIN/OPS): the view is owned by postgres
--    so it bypasses the base-table RLS, and re-implements the staff gate in
--    its own WHERE. Used by the internal order-detail page so a just-cancelled
--    order still renders with its CANCELLED badge.
--
-- 3) client_cancel_own_order — replaces the client portal's direct
--    UPDATE ... SET status='CANCELLED' ... RETURNING. Under (1) the returned
--    representation of a newly cancelled row is empty, which the old code
--    misread as failure. The RPC validates membership + SUBMITTED status,
--    cancels, and writes the same audit row update_order_status would.

-- ============================================================
-- 1) Restrictive policy: cancelled orders invisible by default
-- ============================================================
DROP POLICY IF EXISTS "Cancelled orders hidden by default" ON public.orders;
CREATE POLICY "Cancelled orders hidden by default"
  ON public.orders
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (status <> 'CANCELLED'::public.order_status);

-- ============================================================
-- 2) Staff-only opt-in view including cancelled orders
-- ============================================================
DROP VIEW IF EXISTS public.orders_all;
CREATE VIEW public.orders_all
WITH (security_barrier = true)
AS
SELECT o.*
FROM public.orders o
WHERE public.has_role(auth.uid(), 'ADMIN'::public.app_role)
   OR public.has_role(auth.uid(), 'OPS'::public.app_role);

COMMENT ON VIEW public.orders_all IS
  'Deliberate opt-in read of orders INCLUDING cancelled. Staff (ADMIN/OPS) only — the view owner bypasses orders RLS and the WHERE re-implements the staff gate. Read-only.';

REVOKE ALL ON public.orders_all FROM PUBLIC, anon;
GRANT SELECT ON public.orders_all TO authenticated;

-- ============================================================
-- 3) Client self-cancel RPC (SUBMITTED orders only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.client_cancel_own_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status public.order_status;
BEGIN
  -- Lock the row and verify the caller is an active member of its account.
  SELECT o.status INTO v_status
  FROM public.orders o
  WHERE o.id = p_order_id
    AND EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = o.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  FOR UPDATE OF o;

  -- Not found / not the caller's order / already cancelled-and-hidden all
  -- collapse to false: the client UI shows the same "already processed" hint.
  IF v_status IS NULL THEN
    RETURN false;
  END IF;

  -- Clients may only cancel orders that ops has not started working.
  IF v_status <> 'SUBMITTED'::public.order_status THEN
    RETURN false;
  END IF;

  UPDATE public.orders
  SET status = 'CANCELLED'::public.order_status,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_audit_log
    (order_id, from_status, to_status, changed_by, reason)
  VALUES
    (p_order_id, v_status, 'CANCELLED'::public.order_status, auth.uid(), 'Cancelled by client');

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_cancel_own_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_cancel_own_order(uuid) TO authenticated;
