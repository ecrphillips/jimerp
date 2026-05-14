-- Performance: composite index supporting the standard RLS subquery pattern.
--
-- Hot pattern across account-scoped tables:
--   EXISTS (
--     SELECT 1 FROM public.account_users au
--     WHERE au.account_id = <table>.account_id
--       AND au.user_id = auth.uid()
--       AND au.is_active = true
--   )
--
-- The existing single-column indexes (idx_account_users_account_id,
-- idx_account_users_user_id) require a heap lookup to filter on the other two
-- predicates. A composite (account_id, user_id, is_active) lets the planner
-- satisfy all three predicates from the index alone.
--
-- Uses CREATE INDEX (not CONCURRENTLY) because Supabase migrations run in a
-- transaction and account_users is small; the SHARE lock is brief.

CREATE INDEX IF NOT EXISTS idx_account_users_account_user_active
  ON public.account_users (account_id, user_id, is_active);
