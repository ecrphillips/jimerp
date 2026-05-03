-- Step 6: Retire get_user_client_id().
--
-- Pre-conditions (enforced by prior migrations in this sequence):
--   Step 4 dropped all 11 CLIENT-facing RLS policies that referenced this function
--   and replaced them with account_users-based equivalents.
--   can_access_client() does NOT call get_user_client_id() — it is independent and kept.
--
-- The DROP will fail if any remaining policy or function still references this function,
-- which serves as a safety gate.

DROP FUNCTION public.get_user_client_id(uuid);
