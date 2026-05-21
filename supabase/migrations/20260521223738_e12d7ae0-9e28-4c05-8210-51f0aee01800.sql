-- Helper: is caller an active owner on this account?
CREATE OR REPLACE FUNCTION public._is_account_owner(_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_users
    WHERE account_id = _account_id
      AND user_id = auth.uid()
      AND is_owner = true
      AND is_active = true
  );
$$;

-- 1) Toggle pricing visibility
CREATE OR REPLACE FUNCTION public.owner_set_account_pricing_visibility(
  p_account_id uuid,
  p_hidden boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_account_owner(p_account_id) THEN
    RAISE EXCEPTION 'Only account owners may change this setting';
  END IF;
  UPDATE public.accounts
    SET hide_pricing_from_non_owners = p_hidden,
        updated_at = now()
    WHERE id = p_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_set_account_pricing_visibility(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.owner_set_account_pricing_visibility(uuid, boolean) TO authenticated;

-- 2) List team notification prefs (returns one row per user x event x channel)
CREATE OR REPLACE FUNCTION public.owner_list_team_notification_prefs(p_account_id uuid)
RETURNS TABLE (
  user_id uuid,
  user_name text,
  user_email text,
  is_owner boolean,
  event_type text,
  channel text,
  enabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_account_owner(p_account_id) THEN
    RAISE EXCEPTION 'Only account owners may view team notification settings';
  END IF;

  RETURN QUERY
  SELECT
    au.user_id,
    p.name,
    p.email,
    au.is_owner,
    unp.event_type::text,
    unp.channel::text,
    unp.enabled
  FROM public.account_users au
  LEFT JOIN public.profiles p ON p.user_id = au.user_id
  LEFT JOIN public.user_notification_preferences unp ON unp.user_id = au.user_id
  WHERE au.account_id = p_account_id
    AND au.is_active = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_list_team_notification_prefs(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.owner_list_team_notification_prefs(uuid) TO authenticated;

-- 3) Upsert one notification pref for a team member
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
BEGIN
  IF NOT public._is_account_owner(p_account_id) THEN
    RAISE EXCEPTION 'Only account owners may change team notification settings';
  END IF;

  -- Target user must be an active member of this account
  IF NOT EXISTS (
    SELECT 1 FROM public.account_users
    WHERE account_id = p_account_id
      AND user_id = p_target_user_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Target user is not a member of this account';
  END IF;

  INSERT INTO public.user_notification_preferences (user_id, event_type, channel, enabled)
  VALUES (p_target_user_id, p_event_type, p_channel, p_enabled)
  ON CONFLICT (user_id, event_type, channel)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_set_user_notification_pref(uuid, uuid, text, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.owner_set_user_notification_pref(uuid, uuid, text, text, boolean) TO authenticated;
