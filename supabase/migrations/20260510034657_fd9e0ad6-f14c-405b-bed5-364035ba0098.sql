-- Fix infinite recursion in account_users / accounts / profiles / account_user_locations RLS.
-- Replace self-referential EXISTS subqueries with a SECURITY DEFINER helper.

CREATE OR REPLACE FUNCTION public.is_account_member(_account_id uuid)
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
      AND is_active = true
  );
$$;
REVOKE ALL ON FUNCTION public.is_account_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.account_id_for_account_user(_account_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id FROM public.account_users WHERE id = _account_user_id;
$$;
REVOKE ALL ON FUNCTION public.account_id_for_account_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_id_for_account_user(uuid) TO authenticated;

-- account_users: drop recursive policy, recreate using helper
DROP POLICY IF EXISTS "Account members can read their account team" ON public.account_users;
CREATE POLICY "Account members can read their account team"
  ON public.account_users FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

-- accounts: drop recursive duplicates, recreate using helper
DROP POLICY IF EXISTS "Account members can read their own account" ON public.accounts;
DROP POLICY IF EXISTS "Account members can read their account" ON public.accounts;
CREATE POLICY "Account members can read their account"
  ON public.accounts FOR SELECT TO authenticated
  USING (public.is_account_member(id));

-- profiles: replace teammate policy with non-recursive version
DROP POLICY IF EXISTS "Account members can read teammate profiles" ON public.profiles;
CREATE POLICY "Account members can read teammate profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users teammate
    WHERE teammate.user_id = profiles.user_id
      AND public.is_account_member(teammate.account_id)
  ));

-- account_user_locations: replace recursive team policy
DROP POLICY IF EXISTS "Account members can read team account_user_locations" ON public.account_user_locations;
CREATE POLICY "Account members can read team account_user_locations"
  ON public.account_user_locations FOR SELECT TO authenticated
  USING (public.is_account_member(public.account_id_for_account_user(account_user_id)));
