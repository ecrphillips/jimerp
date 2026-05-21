
DROP FUNCTION IF EXISTS public.owner_list_team_notification_prefs(uuid);

CREATE OR REPLACE FUNCTION public.owner_list_team_notification_prefs(p_account_id uuid)
RETURNS TABLE (
  user_id uuid,
  name text,
  email text,
  is_owner boolean,
  prefs jsonb
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
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'event_type', unp.event_type,
          'channel', unp.channel,
          'enabled', unp.enabled
        ))
        FROM public.user_notification_preferences unp
        WHERE unp.user_id = au.user_id
      ),
      '[]'::jsonb
    ) AS prefs
  FROM public.account_users au
  LEFT JOIN public.profiles p ON p.user_id = au.user_id
  WHERE au.account_id = p_account_id
    AND au.is_active = true
  ORDER BY au.is_owner DESC, p.email NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owner_list_team_notification_prefs(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.owner_list_team_notification_prefs(uuid) TO authenticated;
