-- Enums
DO $$ BEGIN
  CREATE TYPE public.notification_event_type AS ENUM ('ORDER_SUBMITTED','ORDER_CONFIRMED','BOOKING_CREATED','BOOKING_CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_channel AS ENUM ('IN_APP','EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type public.notification_event_type NOT NULL,
  channel public.notification_channel NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type, channel)
);

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own notification prefs" ON public.user_notification_preferences;
CREATE POLICY "Users view own notification prefs"
  ON public.user_notification_preferences FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'ADMIN'));

DROP POLICY IF EXISTS "Users insert own notification prefs" ON public.user_notification_preferences;
CREATE POLICY "Users insert own notification prefs"
  ON public.user_notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notification prefs" ON public.user_notification_preferences;
CREATE POLICY "Users update own notification prefs"
  ON public.user_notification_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own notification prefs" ON public.user_notification_preferences;
CREATE POLICY "Users delete own notification prefs"
  ON public.user_notification_preferences FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_user_notification_preferences_updated_at ON public.user_notification_preferences;
CREATE TRIGGER trg_user_notification_preferences_updated_at
  BEFORE UPDATE ON public.user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed ADMIN/OPS users: IN_APP on, EMAIL off, for all 4 events
INSERT INTO public.user_notification_preferences (user_id, event_type, channel, enabled)
SELECT ur.user_id, ev.event_type, ch.channel,
       CASE WHEN ch.channel = 'IN_APP' THEN true ELSE false END
FROM (SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('ADMIN','OPS')) ur
CROSS JOIN (VALUES
  ('ORDER_SUBMITTED'::public.notification_event_type),
  ('ORDER_CONFIRMED'::public.notification_event_type),
  ('BOOKING_CREATED'::public.notification_event_type),
  ('BOOKING_CANCELLED'::public.notification_event_type)
) AS ev(event_type)
CROSS JOIN (VALUES
  ('IN_APP'::public.notification_channel),
  ('EMAIL'::public.notification_channel)
) AS ch(channel)
ON CONFLICT (user_id, event_type, channel) DO NOTHING;

-- Seed shared mailbox routing in app_settings
INSERT INTO public.app_settings (key, value_json, updated_at)
VALUES
  ('notification_routes.ORDER_SUBMITTED',  '{"shared_email":"orders@homeislandcoffee.com","enabled":true}'::jsonb, now()),
  ('notification_routes.ORDER_CONFIRMED',  '{"shared_email":"orders@homeislandcoffee.com","enabled":false}'::jsonb, now()),
  ('notification_routes.BOOKING_CREATED',  '{"shared_email":"orders@homeislandcoffee.com","enabled":true}'::jsonb, now()),
  ('notification_routes.BOOKING_CANCELLED','{"shared_email":"orders@homeislandcoffee.com","enabled":false}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
