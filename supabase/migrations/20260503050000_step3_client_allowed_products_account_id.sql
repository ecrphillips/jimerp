-- Step 3: Add account_id to client_allowed_products and backfill.
--
-- No account_allowed_products table exists, so we extend the existing table per the
-- Step 3 rule: add account_id, backfill from join, add RLS in Step 4.
--
-- Backfill join: client_allowed_products.product_id → products.account_id
-- This is reliable because (a) each row has a product_id FK, and (b) products.account_id
-- was fully backfilled in Step 2.
--
-- After backfill, raises an exception if any orphans remain so the migration does not
-- silently proceed with dangling NULLs.

-- 1. Add the column (nullable initially to allow backfill before enforcing NOT NULL)
ALTER TABLE public.client_allowed_products
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_client_allowed_products_account_id
  ON public.client_allowed_products (account_id);

-- 2. Backfill via products.account_id
DO $$
DECLARE
  v_backfilled int;
  v_orphans    int;
BEGIN
  WITH upd AS (
    UPDATE public.client_allowed_products cap
    SET account_id = p.account_id
    FROM public.products p
    WHERE p.id = cap.product_id
      AND cap.account_id IS NULL
      AND p.account_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_backfilled FROM upd;

  SELECT count(*) INTO v_orphans
  FROM public.client_allowed_products
  WHERE account_id IS NULL;

  RAISE NOTICE 'client_allowed_products: % rows backfilled, % orphans remaining',
    v_backfilled, v_orphans;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'client_allowed_products backfill incomplete: % row(s) could not be mapped to an account_id. '
      'Ensure products.account_id is fully populated (Step 2) before running this migration.',
      v_orphans;
  END IF;
END;
$$;
