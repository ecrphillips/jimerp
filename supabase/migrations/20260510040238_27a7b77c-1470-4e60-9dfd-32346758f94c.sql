-- Fix recursive RLS policies reintroduced around account visibility.
-- These helpers read account_users with SECURITY DEFINER so policies do not recurse.

CREATE OR REPLACE FUNCTION public.account_user_is_on_my_account(_account_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_users target_au
    JOIN public.account_users self_au
      ON self_au.account_id = target_au.account_id
    WHERE target_au.id = _account_user_id
      AND self_au.user_id = auth.uid()
      AND self_au.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.profile_is_on_my_account(_profile_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_users teammate
    JOIN public.account_users self_au
      ON self_au.account_id = teammate.account_id
    WHERE teammate.user_id = _profile_user_id
      AND self_au.user_id = auth.uid()
      AND self_au.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.account_user_is_on_my_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_user_is_on_my_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.account_user_is_on_my_account(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.profile_is_on_my_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_is_on_my_account(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_is_on_my_account(uuid) TO authenticated;

-- Remove recursive/duplicate policies.
DROP POLICY IF EXISTS "Account members can read their account team" ON public.account_users;
DROP POLICY IF EXISTS "Account members can read their own account" ON public.accounts;
DROP POLICY IF EXISTS "Account members can read teammate profiles" ON public.profiles;
DROP POLICY IF EXISTS "Account members can read team account_user_locations" ON public.account_user_locations;
DROP POLICY IF EXISTS "Users can read their own account_user_locations" ON public.account_user_locations;

-- Recreate client-facing read rules without direct self-references in policy bodies.
CREATE POLICY "Account members can read their account team"
ON public.account_users
FOR SELECT
TO authenticated
USING (public.is_account_member(account_id));

CREATE POLICY "Account members can read teammate profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.profile_is_on_my_account(user_id));

CREATE POLICY "Account members can read team account_user_locations"
ON public.account_user_locations
FOR SELECT
TO authenticated
USING (public.account_user_is_on_my_account(account_user_id));
