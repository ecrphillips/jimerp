-- Step 3: Add account_id to client_allowed_products and backfill.
-- No account_allowed_products table exists, so the column is added to the existing table.
-- Backfill path: client_allowed_products.product_id → products.account_id
-- (products.account_id was fully backfilled in Step 2).
-- Raises EXCEPTION on orphans.

ALTER TABLE public.client_allowed_products
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_client_allowed_products_account_id
  ON public.client_allowed_products(account_id);

DO $$
DECLARE
  v_backfilled integer;
  v_orphans    integer;
BEGIN

  UPDATE public.client_allowed_products cap
  SET account_id = p.account_id
  FROM public.products p
  WHERE cap.account_id IS NULL
    AND cap.product_id = p.id
    AND p.account_id IS NOT NULL;

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;
  RAISE NOTICE 'client_allowed_products: % rows backfilled', v_backfilled;

  SELECT COUNT(*) INTO v_orphans
  FROM public.client_allowed_products
  WHERE account_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'client_allowed_products: % rows have no account_id after backfill — migration aborted', v_orphans;
  END IF;

  RAISE NOTICE 'Step 3 complete';
END $$;
