-- Shopify daily order pull: seed the No Smoke Coffee source and schedule the
-- shopify-pull-orders edge function via pg_cron.

ALTER TABLE public.shopify_sources
  ADD COLUMN IF NOT EXISTS oauth_client_id text,
  ADD COLUMN IF NOT EXISTS oauth_client_secret text;
REVOKE SELECT (oauth_client_secret) ON public.shopify_sources FROM authenticated;
REVOKE SELECT (oauth_client_secret) ON public.shopify_sources FROM anon;

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