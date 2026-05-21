CREATE OR REPLACE FUNCTION public.owner_set_user_notification_pref(
  p_account_id uuid,
  p_target_user_id uuid,
  p_event_type text,
  p_channel text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type public.notification_event_type;
  v_channel public.notification_channel;
BEGIN
  IF NOT public._is_account_owner(p_account_id) THEN
    RAISE EXCEPTION 'Only account owners may change team notification settings';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.account_users
    WHERE account_id = p_account_id
      AND user_id = p_target_user_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Target user is not a member of this account';
  END IF;

  BEGIN
    v_event_type := p_event_type::public.notification_event_type;
    v_channel := p_channel::public.notification_channel;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid notification preference value';
  END;

  INSERT INTO public.user_notification_preferences (user_id, event_type, channel, enabled)
  VALUES (p_target_user_id, v_event_type, v_channel, p_enabled)
  ON CONFLICT (user_id, event_type, channel)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_set_user_notification_pref(uuid, uuid, text, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.owner_set_user_notification_pref(uuid, uuid, text, text, boolean) TO authenticated;