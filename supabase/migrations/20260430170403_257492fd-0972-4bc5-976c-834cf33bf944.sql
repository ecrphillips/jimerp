
-- ============================================================
-- 1) Fix mutable search_path on email queue helpers
-- ============================================================
ALTER FUNCTION public.enqueue_email(text, jsonb)             SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint)             SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;

-- ============================================================
-- 2) Lock down EXECUTE on SECURITY DEFINER functions
-- ============================================================
-- Trigger functions: should never be called directly by any client
REVOKE EXECUTE ON FUNCTION public.handle_updated_at()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_date_changes()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_order_number()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_read_by_update()     FROM PUBLIC, anon, authenticated;

-- Email queue helpers: backend / edge-function use only
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;

-- Sequence/util helpers: not needed by anon
REVOKE EXECUTE ON FUNCTION public.nextval_text(text)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.allocate_sourcing_sequence(text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decrement_lot_kg(uuid, numeric)    FROM PUBLIC, anon;

-- Auth/role helpers: keep authenticated, revoke anon
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_client(uuid, uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_client_id(uuid)          FROM PUBLIC, anon;

-- Admin-gated RPCs: revoke anon (functions enforce role checks internally)
REVOKE EXECUTE ON FUNCTION public.delete_client_safe(uuid, boolean)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_order_safe(uuid, boolean)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_product_safe(uuid, boolean)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_roast_group_safe(text, boolean)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_client_delete_preflight(uuid)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_order_delete_preflight(uuid)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_product_delete_preflight(uuid)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_roast_group_delete_preflight(text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dev_reset_master_data()                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dev_reset_test_day()                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dev_test_reset()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dev_test_seed_minimal()                   FROM PUBLIC, anon;

-- ============================================================
-- 3) Allow account members to read their own account record
-- ============================================================
CREATE POLICY "Account members can read their account"
ON public.accounts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = accounts.id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

-- ============================================================
-- 4) Explicit anon-deny on green_purchases (consistency)
-- ============================================================
CREATE POLICY "Deny anon green_purchases"
ON public.green_purchases
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

-- ============================================================
-- 5) Realtime channel authorization
-- ============================================================
-- Restrict the order_notifications broadcast/presence topic to Admin/Ops.
-- Other topics remain available to authenticated users (postgres_changes
-- subscriptions are still independently filtered by per-table RLS).
DROP POLICY IF EXISTS "Authenticated can use realtime channels" ON realtime.messages;
CREATE POLICY "Authenticated can use realtime channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  CASE
    WHEN realtime.topic() = 'order_notifications' THEN
      public.has_role(auth.uid(), 'ADMIN'::public.app_role)
      OR public.has_role(auth.uid(), 'OPS'::public.app_role)
    ELSE true
  END
);

DROP POLICY IF EXISTS "Authenticated can broadcast on realtime channels" ON realtime.messages;
CREATE POLICY "Authenticated can broadcast on realtime channels"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  CASE
    WHEN realtime.topic() = 'order_notifications' THEN
      public.has_role(auth.uid(), 'ADMIN'::public.app_role)
      OR public.has_role(auth.uid(), 'OPS'::public.app_role)
    ELSE true
  END
);
