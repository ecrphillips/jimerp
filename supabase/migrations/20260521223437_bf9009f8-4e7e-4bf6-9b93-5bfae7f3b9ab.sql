-- Seed new notification_routes entries (if not already present)
INSERT INTO public.app_settings (key, value_json, updated_at)
VALUES
  ('notification_routes.ORDER_SHIPPED', '{"enabled": false, "shared_email": "orders@homeislandcoffee.com"}'::jsonb, now()),
  ('notification_routes.ORDER_CANCELLED', '{"enabled": true, "shared_email": "orders@homeislandcoffee.com"}'::jsonb, now()),
  ('notification_routes.ORDER_CLIENT_EDITED', '{"enabled": true, "shared_email": "orders@homeislandcoffee.com"}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- Also update ORDER_SUBMITTED default to enabled (already true in current data, but make idempotent for fresh envs)
UPDATE public.app_settings
SET value_json = jsonb_set(
    COALESCE(value_json, '{}'::jsonb),
    '{shared_email}',
    '"orders@homeislandcoffee.com"'::jsonb,
    true
  )
WHERE key IN ('notification_routes.ORDER_SUBMITTED','notification_routes.ORDER_CANCELLED','notification_routes.ORDER_CLIENT_EDITED')
  AND (value_json->>'shared_email') IS NULL;

-- Pricing visibility flag on accounts
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS hide_pricing_from_non_owners boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.hide_pricing_from_non_owners IS
  'When true, only account owners (account_users.is_owner = true) see dollar amounts in the client portal.';
