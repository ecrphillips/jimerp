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
    WHEN realtime.topic() = 'production-realtime' THEN
      public.has_role(auth.uid(), 'ADMIN'::public.app_role)
      OR public.has_role(auth.uid(), 'OPS'::public.app_role)
    WHEN realtime.topic() LIKE 'account-users-%' THEN
      public.has_role(auth.uid(), 'ADMIN'::public.app_role)
      OR public.has_role(auth.uid(), 'OPS'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.account_users au
        WHERE au.user_id = auth.uid()
          AND au.is_active = true
          AND au.account_id::text = substring(realtime.topic() from 'account-users-(.*)')
      )
    ELSE false
  END
);