-- Account Owner Self-Service Management
-- Enables CLIENT users with is_owner=true (or specific permission flags) to manage
-- their account info, team members, and locations from the client/member portals.
--
-- All writes go through SECURITY DEFINER RPCs that enforce:
--   * Caller is an active owner of the EXACT target account
--   * Cannot deactivate self
--   * Cannot remove last active owner
--   * Allowed fields only on account update
--   * Program-aware permission grants

-- =============================================================================
-- 1. RLS SELECT policies (allow account members to read their own data)
-- =============================================================================

-- Allow any active account member to read their own account row.
-- Fixes a current bug where Account.tsx queries accounts directly but gets
-- nothing back because the only existing policy is ADMIN/OPS.
DROP POLICY IF EXISTS "Account members can read their own account" ON public.accounts;
CREATE POLICY "Account members can read their own account"
  ON public.accounts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = accounts.id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  ));

-- Allow account members to read all account_users rows in their account.
-- The existing "Users can read their own account_users row" policy only exposes
-- the caller's own row; this broader policy is needed for the team list.
DROP POLICY IF EXISTS "Account members can read their account team" ON public.account_users;
CREATE POLICY "Account members can read their account team"
  ON public.account_users FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.account_users self_au
    WHERE self_au.account_id = account_users.account_id
      AND self_au.user_id = auth.uid()
      AND self_au.is_active = true
  ));

-- Allow account members to read profiles for everyone in their account
-- (needed to render team list with names + emails).
DROP POLICY IF EXISTS "Account members can read teammate profiles" ON public.profiles;
CREATE POLICY "Account members can read teammate profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.account_users teammate
    JOIN public.account_users self_au
      ON self_au.account_id = teammate.account_id
    WHERE teammate.user_id = profiles.user_id
      AND self_au.user_id = auth.uid()
      AND self_au.is_active = true
  ));

-- Allow account members to read account_user_locations for their team.
DROP POLICY IF EXISTS "Account members can read team account_user_locations" ON public.account_user_locations;
CREATE POLICY "Account members can read team account_user_locations"
  ON public.account_user_locations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.account_users target_au
    JOIN public.account_users self_au
      ON self_au.account_id = target_au.account_id
    WHERE target_au.id = account_user_locations.account_user_id
      AND self_au.user_id = auth.uid()
      AND self_au.is_active = true
  ));

-- =============================================================================
-- 2. Owner assertion helper
-- =============================================================================

CREATE OR REPLACE FUNCTION public._assert_account_owner(_account_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = _account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
      AND au.is_owner = true
  ) THEN
    RAISE EXCEPTION 'Not an owner of this account';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_account_owner(uuid) FROM PUBLIC, anon;

-- =============================================================================
-- 3. RPC: owner_update_account
-- =============================================================================

CREATE OR REPLACE FUNCTION public.owner_update_account(
  p_account_id uuid,
  p_account_name text,
  p_billing_contact_name text DEFAULT NULL,
  p_billing_email text DEFAULT NULL,
  p_billing_phone text DEFAULT NULL,
  p_billing_address text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email text;
BEGIN
  PERFORM public._assert_account_owner(p_account_id);

  IF p_account_name IS NULL OR TRIM(p_account_name) = '' THEN
    RAISE EXCEPTION 'Account name is required';
  END IF;

  v_clean_email := NULLIF(LOWER(TRIM(COALESCE(p_billing_email, ''))), '');

  UPDATE public.accounts
  SET
    account_name         = TRIM(p_account_name),
    billing_contact_name = NULLIF(TRIM(COALESCE(p_billing_contact_name, '')), ''),
    billing_email        = v_clean_email,
    billing_phone        = NULLIF(TRIM(COALESCE(p_billing_phone, '')), ''),
    billing_address      = NULLIF(TRIM(COALESCE(p_billing_address, '')), ''),
    updated_at           = now()
  WHERE id = p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_update_account(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_account(uuid, text, text, text, text, text) TO authenticated;

-- =============================================================================
-- 4. RPC: owner_update_user_permissions
-- =============================================================================

CREATE OR REPLACE FUNCTION public.owner_update_user_permissions(
  p_account_id uuid,
  p_account_user_id uuid,
  p_is_owner boolean,
  p_can_place_orders boolean,
  p_can_book_roaster boolean,
  p_can_manage_locations boolean,
  p_can_invite_users boolean,
  p_location_access text,
  p_assigned_location_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
  v_target_was_owner boolean;
  v_active_owner_count int;
  v_programs text[];
  v_orphan_location uuid;
BEGIN
  PERFORM public._assert_account_owner(p_account_id);

  -- Verify target row belongs to this account; capture current owner status.
  SELECT user_id, is_owner
    INTO v_target_user_id, v_target_was_owner
    FROM public.account_users
   WHERE id = p_account_user_id
     AND account_id = p_account_id;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found in this account';
  END IF;

  -- If revoking owner, ensure at least one other active owner remains.
  IF v_target_was_owner AND NOT p_is_owner THEN
    SELECT COUNT(*) INTO v_active_owner_count
      FROM public.account_users
     WHERE account_id = p_account_id
       AND is_owner = true
       AND is_active = true
       AND id <> p_account_user_id;

    IF v_active_owner_count < 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner from the account';
    END IF;
  END IF;

  -- Program-aware permission guardrails.
  SELECT programs INTO v_programs
    FROM public.accounts WHERE id = p_account_id;

  IF p_can_place_orders AND NOT ('MANUFACTURING' = ANY(COALESCE(v_programs, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Cannot grant can_place_orders: account does not have MANUFACTURING program';
  END IF;

  IF p_can_book_roaster AND NOT ('COROASTING' = ANY(COALESCE(v_programs, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Cannot grant can_book_roaster: account does not have COROASTING program';
  END IF;

  IF p_location_access NOT IN ('ALL', 'ASSIGNED') THEN
    RAISE EXCEPTION 'Invalid location_access value (must be ALL or ASSIGNED)';
  END IF;

  -- Validate assigned location IDs all belong to this account before any writes.
  IF p_location_access = 'ASSIGNED' AND COALESCE(array_length(p_assigned_location_ids, 1), 0) > 0 THEN
    SELECT lid INTO v_orphan_location
      FROM UNNEST(p_assigned_location_ids) lid
     WHERE NOT EXISTS (
       SELECT 1 FROM public.account_locations al
        WHERE al.id = lid AND al.account_id = p_account_id
     )
     LIMIT 1;

    IF v_orphan_location IS NOT NULL THEN
      RAISE EXCEPTION 'Location % does not belong to this account', v_orphan_location;
    END IF;
  END IF;

  UPDATE public.account_users
  SET
    is_owner             = p_is_owner,
    can_place_orders     = p_can_place_orders,
    can_book_roaster     = p_can_book_roaster,
    can_manage_locations = p_can_manage_locations,
    can_invite_users     = p_can_invite_users,
    location_access      = p_location_access,
    updated_at           = now()
  WHERE id = p_account_user_id
    AND account_id = p_account_id;

  -- Replace location assignments.
  DELETE FROM public.account_user_locations
   WHERE account_user_id = p_account_user_id;

  IF p_location_access = 'ASSIGNED' AND COALESCE(array_length(p_assigned_location_ids, 1), 0) > 0 THEN
    INSERT INTO public.account_user_locations (account_user_id, location_id)
    SELECT p_account_user_id, lid FROM UNNEST(p_assigned_location_ids) lid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_update_user_permissions(uuid, uuid, boolean, boolean, boolean, boolean, boolean, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_user_permissions(uuid, uuid, boolean, boolean, boolean, boolean, boolean, text, uuid[]) TO authenticated;

-- =============================================================================
-- 5. RPC: owner_deactivate_user
-- =============================================================================

CREATE OR REPLACE FUNCTION public.owner_deactivate_user(
  p_account_id uuid,
  p_account_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_user_id uuid;
  v_target_is_owner boolean;
  v_target_is_active boolean;
  v_active_owner_count int;
BEGIN
  PERFORM public._assert_account_owner(p_account_id);

  SELECT user_id, is_owner, is_active
    INTO v_target_user_id, v_target_is_owner, v_target_is_active
    FROM public.account_users
   WHERE id = p_account_user_id
     AND account_id = p_account_id;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found in this account';
  END IF;

  IF v_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot deactivate your own account';
  END IF;

  -- If target is an active owner, ensure at least one other active owner remains.
  IF v_target_is_owner AND v_target_is_active THEN
    SELECT COUNT(*) INTO v_active_owner_count
      FROM public.account_users
     WHERE account_id = p_account_id
       AND is_owner = true
       AND is_active = true
       AND id <> p_account_user_id;

    IF v_active_owner_count < 1 THEN
      RAISE EXCEPTION 'Cannot deactivate the last active owner';
    END IF;
  END IF;

  UPDATE public.account_users
  SET is_active = false,
      updated_at = now()
  WHERE id = p_account_user_id
    AND account_id = p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_deactivate_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_deactivate_user(uuid, uuid) TO authenticated;

-- =============================================================================
-- 6. RPC: owner_create_location (manufacturing accounts only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.owner_create_location(
  p_account_id uuid,
  p_location_name text,
  p_location_code text,
  p_address text DEFAULT NULL,
  p_qbo_billing_entity text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
  v_caller_can_manage boolean;
  v_clean_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Allow either owner OR member with can_manage_locations.
  SELECT (is_owner OR can_manage_locations) INTO v_caller_can_manage
    FROM public.account_users
   WHERE account_id = p_account_id
     AND user_id = auth.uid()
     AND is_active = true;

  IF NOT COALESCE(v_caller_can_manage, false) THEN
    RAISE EXCEPTION 'Not authorized to manage locations for this account';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
     WHERE id = p_account_id
       AND 'MANUFACTURING' = ANY(COALESCE(programs, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Location management is only available for accounts with the MANUFACTURING program';
  END IF;

  IF p_location_name IS NULL OR TRIM(p_location_name) = '' THEN
    RAISE EXCEPTION 'Location name is required';
  END IF;

  IF p_location_code IS NULL OR TRIM(p_location_code) = '' THEN
    RAISE EXCEPTION 'Location code is required';
  END IF;

  v_clean_code := UPPER(TRIM(p_location_code));

  -- Reject duplicate location_code within the same account.
  IF EXISTS (
    SELECT 1 FROM public.account_locations
     WHERE account_id = p_account_id
       AND UPPER(location_code) = v_clean_code
  ) THEN
    RAISE EXCEPTION 'A location with code % already exists for this account', v_clean_code;
  END IF;

  INSERT INTO public.account_locations (
    account_id, location_name, location_code, address, qbo_billing_entity, is_active
  )
  VALUES (
    p_account_id,
    TRIM(p_location_name),
    v_clean_code,
    NULLIF(TRIM(COALESCE(p_address, '')), ''),
    NULLIF(TRIM(COALESCE(p_qbo_billing_entity, '')), ''),
    true
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_create_location(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_create_location(uuid, text, text, text, text) TO authenticated;
