-- Shopify daily order pull: seed the No Smoke Coffee source and schedule the
-- shopify-pull-orders edge function via pg_cron.
--
-- Post-migration manual steps (secrets, cannot live in static SQL):
--   1. Store the service_role key in vault (used by the cron job to call the function):
--        SELECT vault.create_secret('<service_role_key>', 'shopify_pull_service_role_key');
--   2. Set the Shopify app credentials on the source and activate it. Dev Dashboard
--      apps use the OAuth client-credentials grant (24h tokens fetched at pull time):
--        UPDATE public.shopify_sources
--        SET oauth_client_id = '...', oauth_client_secret = '...',
--            api_scopes = 'read_orders,read_products,write_products', is_active = true
--        WHERE store_slug = 'no-smoke-coffee';
--      (Legacy admin-created custom apps can instead set api_access_token = 'shpat_...'.)
-- The cron job no-ops safely until step 1 is done; the function skips sources
-- without credentials until step 2 is done.

-- 0) OAuth client-credentials columns for Dev Dashboard apps. Secret column is
--    locked to service_role, matching api_access_token (20260608210119).
ALTER TABLE public.shopify_sources
  ADD COLUMN IF NOT EXISTS oauth_client_id text,
  ADD COLUMN IF NOT EXISTS oauth_client_secret text;
REVOKE SELECT (oauth_client_secret) ON public.shopify_sources FROM authenticated;
REVOKE SELECT (oauth_client_secret) ON public.shopify_sources FROM anon;

-- 1) Seed the No Smoke Coffee source (inactive until token configured).
--    Inserts nothing if no matching account exists yet.
INSERT INTO public.shopify_sources
  (store_name, store_slug, store_url, linked_account_id, pull_cadence, is_active)
SELECT
  'No Smoke Coffee',
  'no-smoke-coffee',
  'https://no-smoke-coffee.myshopify.com',
  a.id,
  'daily',
  false
FROM public.accounts a
WHERE a.account_name ILIKE '%no smoke%'
ORDER BY a.created_at
LIMIT 1
ON CONFLICT (store_slug) DO NOTHING;

-- 2) Daily pull at 13:00 UTC (= 6:00 AM PDT; runs 5:00 AM PST in winter).
--    Service-role key comes from vault: prefers 'shopify_pull_service_role_key',
--    falls back to 'email_queue_service_role_key' (already seeded by the email
--    infra setup). Guarded: does nothing until one of them exists.
--    URL targets the live (Lovable Cloud) project; when the app moves to the
--    new Supabase project, re-run cron.schedule with the new ref.
SELECT cron.unschedule('shopify-pull-orders-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shopify-pull-orders-daily');

SELECT cron.schedule(
  'shopify-pull-orders-daily',
  '0 13 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://cgdzjkryygwlyygeznrb.supabase.co/functions/v1/shopify-pull-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || s.decrypted_secret
    ),
    body := '{"trigger":"scheduled"}'::jsonb
  )
  FROM (
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name IN ('shopify_pull_service_role_key', 'email_queue_service_role_key')
    ORDER BY (name = 'shopify_pull_service_role_key') DESC
    LIMIT 1
  ) s;
  $cron$
);
