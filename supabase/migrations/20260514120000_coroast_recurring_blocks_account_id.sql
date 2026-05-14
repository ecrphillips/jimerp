-- Add account_id to coroast_recurring_blocks and rewrite member-read RLS to
-- the account-scoped subquery pattern used elsewhere in the coroast schema.
--
-- Backfill source: member_id. Per the 20260414230648 migration the FK from
-- member_id -> coroast_members(id) was dropped and member_id became nullable;
-- admin and member-portal write paths have since been populating member_id
-- with the account UUID. Rows whose member_id matches an accounts.id row
-- are backfilled; the migration fails loudly if any rows would be left NULL.
--
-- member_id is intentionally NOT dropped in this migration. It remains
-- nullable for backwards compatibility while admin/RPC writes are migrated
-- to account_id. A follow-up migration can drop it once writes are clean.

BEGIN;

ALTER TABLE public.coroast_recurring_blocks
  ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

UPDATE public.coroast_recurring_blocks rb
SET account_id = rb.member_id
WHERE rb.account_id IS NULL
  AND rb.member_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = rb.member_id);

DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.coroast_recurring_blocks
  WHERE account_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'coroast_recurring_blocks: % row(s) have NULL account_id after backfill; resolve orphans before applying',
      v_orphans;
  END IF;
END $$;

ALTER TABLE public.coroast_recurring_blocks
  ALTER COLUMN account_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coroast_recurring_blocks_account
  ON public.coroast_recurring_blocks (account_id);

-- Rewrite member-read RLS: old policy gated only on program membership,
-- letting any active COROASTING user read every recurring block. Replace
-- with the standard account-scoped subquery used on coroast_bookings etc.
DROP POLICY IF EXISTS "Active co-roasting members can read coroast_recurring_blocks"
  ON public.coroast_recurring_blocks;

CREATE POLICY "Account members can read coroast_recurring_blocks"
  ON public.coroast_recurring_blocks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = coroast_recurring_blocks.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

COMMIT;
