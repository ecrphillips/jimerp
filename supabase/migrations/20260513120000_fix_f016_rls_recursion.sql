-- F-016: Fix HTTP 500/503 on accounts/profiles/products/price_list/order_line_items/feedback_submissions.
--
-- Symptom: REST calls return 500 (42P17 infinite recursion) or 503 (statement timeout) for
-- authenticated Admin/Ops users on every table whose RLS joins public.account_users.
--
-- Root cause: migration 20260509212831 introduced self-referential EXISTS subqueries inside
-- RLS policies on account_users / accounts / profiles / account_user_locations. Follow-up
-- migrations 20260510034657 and 20260510040238 added SECURITY DEFINER helpers
-- (is_account_member, profile_is_on_my_account, account_user_is_on_my_account,
-- account_id_for_account_user) but the live DB still has at least one recursive variant in
-- place — likely under a differently spelled policy name that DROP POLICY IF EXISTS missed.
--
-- This migration is idempotent: it re-declares the helpers, force-drops every known recursive
-- variant by name, and recreates the SELECT policies via the SECURITY DEFINER helpers. Tables
-- that only join account_users from the outside (products, price_list, order_line_items,
-- feedback_submissions) are intentionally untouched — once the underlying recursion is gone,
-- their existing EXISTS subqueries succeed.

-- ── Helpers (no-op if already present from 20260510034657 / 20260510040238) ────────────────
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
REVOKE ALL ON FUNCTION public.profile_is_on_my_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_is_on_my_account(uuid) TO authenticated;

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
REVOKE ALL ON FUNCTION public.account_user_is_on_my_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_user_is_on_my_account(uuid) TO authenticated;

-- ── account_users: drop every known recursive variant, recreate via helper ─────────────────
DROP POLICY IF EXISTS "Account members can read their account team" ON public.account_users;
DROP POLICY IF EXISTS "Account members can read teammate account_users" ON public.account_users;
DROP POLICY IF EXISTS "Users can read account_users in their account" ON public.account_users;
DROP POLICY IF EXISTS "Account members can read account_users" ON public.account_users;
DROP POLICY IF EXISTS "Users can read teammate account_users" ON public.account_users;

CREATE POLICY "Account members can read their account team"
  ON public.account_users FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

-- ── accounts: drop every known recursive variant, recreate via helper ──────────────────────
DROP POLICY IF EXISTS "Account members can read their account" ON public.accounts;
DROP POLICY IF EXISTS "Account members can read their own account" ON public.accounts;
DROP POLICY IF EXISTS "Users can read their own account" ON public.accounts;

CREATE POLICY "Account members can read their account"
  ON public.accounts FOR SELECT TO authenticated
  USING (public.is_account_member(id));

-- ── profiles: drop every known recursive variant, recreate via helper ──────────────────────
DROP POLICY IF EXISTS "Account members can read teammate profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read teammate profiles" ON public.profiles;

CREATE POLICY "Account members can read teammate profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.profile_is_on_my_account(user_id));

-- ── account_user_locations: drop every known recursive variant, recreate via helper ────────
DROP POLICY IF EXISTS "Account members can read team account_user_locations" ON public.account_user_locations;
DROP POLICY IF EXISTS "Users can read their own account_user_locations" ON public.account_user_locations;
DROP POLICY IF EXISTS "Account members can read account_user_locations" ON public.account_user_locations;

CREATE POLICY "Account members can read team account_user_locations"
  ON public.account_user_locations FOR SELECT TO authenticated
  USING (public.account_user_is_on_my_account(account_user_id));
