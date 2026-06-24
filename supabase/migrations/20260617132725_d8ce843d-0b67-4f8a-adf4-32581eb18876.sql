-- 1) Tighten realtime INSERT (broadcast) policy to mirror SELECT restrictions
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

-- 2) Re-assert column-level REVOKE on shopify_sources secret columns.
REVOKE SELECT (api_access_token) ON public.shopify_sources FROM authenticated;
REVOKE SELECT (api_access_token) ON public.shopify_sources FROM anon;
REVOKE SELECT (oauth_client_secret) ON public.shopify_sources FROM authenticated;
REVOKE SELECT (oauth_client_secret) ON public.shopify_sources FROM anon;

-- Re-grant explicit non-secret column SELECT so the app keeps working for ADMIN/OPS.
GRANT SELECT (
  id, store_name, store_slug, linked_account_id, store_url,
  api_scopes, token_expires_at, pull_cadence, pull_schedule_cron,
  default_short_ship_reason, is_active, owner_notes,
  created_at, updated_at, oauth_client_id
) ON public.shopify_sources TO authenticated;