-- Notification preferences + shared mailbox routing
-- Per-user channel prefs for events + ADMIN-managed shared mailbox routes.

-- 1. Enums --------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.notification_event_type AS ENUM (
    'ORDER_SUBMITTED',
    'ORDER_CONFIRMED',
    'BOOKING_CREATED',
    'BOOKING_CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_channel AS ENUM ('IN_APP', 'EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Per-user preferences -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  public.notification_event_type NOT NULL,
  channel     public.notification_channel NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS user_notification_preferences_user_idx
  ON public.user_notification_preferences (user_id);

CREATE INDEX IF NOT EXISTS user_notification_preferences_event_lookup_idx
  ON public.user_notification_preferences (event_type, channel)
  WHERE enabled = true;

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users manage their own rows
CREATE POLICY "Users select own notification prefs"
  ON public.user_notification_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own notification prefs"
  ON public.user_notification_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own notification prefs"
  ON public.user_notification_preferences FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own notification prefs"
  ON public.user_notification_preferences FOR DELETE
  USING (user_id = auth.uid());

-- ADMIN can read all (for visibility / debugging)
CREATE POLICY "Admin read all notification prefs"
  ON public.user_notification_preferences FOR SELECT
  USING (has_role(auth.uid(), 'ADMIN'::app_role));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._touch_user_notification_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notification_prefs_touch ON public.user_notification_preferences;
CREATE TRIGGER user_notification_prefs_touch
  BEFORE UPDATE ON public.user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public._touch_user_notification_prefs();

-- 3. Seed defaults for existing ADMIN/OPS users -------------------------------
-- In-app on, email off (opt-in) for every supported event.

INSERT INTO public.user_notification_preferences (user_id, event_type, channel, enabled)
SELECT ur.user_id, et.event_type, 'IN_APP'::public.notification_channel, true
FROM public.user_roles ur
CROSS JOIN (
  VALUES
    ('ORDER_SUBMITTED'::public.notification_event_type),
    ('ORDER_CONFIRMED'::public.notification_event_type),
    ('BOOKING_CREATED'::public.notification_event_type),
    ('BOOKING_CANCELLED'::public.notification_event_type)
) AS et(event_type)
WHERE ur.role IN ('ADMIN'::app_role, 'OPS'::app_role)
ON CONFLICT (user_id, event_type, channel) DO NOTHING;

INSERT INTO public.user_notification_preferences (user_id, event_type, channel, enabled)
SELECT ur.user_id, et.event_type, 'EMAIL'::public.notification_channel, false
FROM public.user_roles ur
CROSS JOIN (
  VALUES
    ('ORDER_SUBMITTED'::public.notification_event_type),
    ('ORDER_CONFIRMED'::public.notification_event_type),
    ('BOOKING_CREATED'::public.notification_event_type),
    ('BOOKING_CANCELLED'::public.notification_event_type)
) AS et(event_type)
WHERE ur.role IN ('ADMIN'::app_role, 'OPS'::app_role)
ON CONFLICT (user_id, event_type, channel) DO NOTHING;

-- 4. Shared mailbox routes (one app_settings row per event) -------------------

INSERT INTO public.app_settings (key, value_json) VALUES
  ('notification_routes.ORDER_SUBMITTED',  '{"shared_email": "orders@homeislandcoffee.com", "enabled": true}'::jsonb),
  ('notification_routes.ORDER_CONFIRMED',  '{"shared_email": "orders@homeislandcoffee.com", "enabled": false}'::jsonb),
  ('notification_routes.BOOKING_CREATED',  '{"shared_email": "orders@homeislandcoffee.com", "enabled": true}'::jsonb),
  ('notification_routes.BOOKING_CANCELLED','{"shared_email": "orders@homeislandcoffee.com", "enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
