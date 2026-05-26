-- Reproducibility marker for SQL hand-applied via the Lovable SQL editor.
-- Already applied to the live DB — this file exists so the schema is
-- recoverable from supabase/migrations/. Idempotent: safe to re-run.

DO $$
BEGIN
  CREATE TYPE account_status AS ENUM ('PROSPECT', 'ACTIVE', 'PAUSED', 'CHURNED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS account_status account_status NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS prospect_selected_tier TEXT;

COMMENT ON COLUMN accounts.account_status IS
  'Lifecycle stage: PROSPECT = previewing portal pre-signup, ACTIVE = paying member, PAUSED = temporarily suspended, CHURNED = ended.';

COMMENT ON COLUMN accounts.prospect_selected_tier IS
  'Tier (MEMBER|GROWTH|PRODUCTION) chosen by a PROSPECT in the signup banner. Null until they submit. Cleared / superseded when account_status flips to ACTIVE.';
