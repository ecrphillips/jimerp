-- Step 3: Add account_id to client_allowed_products and backfill from products.account_id.
-- No account_allowed_products table exists, so the column is added here.
-- Backfill path: client_allowed_products.product_id -> products.account_id.
-- After Step 2, all products rows with client_id have account_id set, so this join is safe.
-- Raises EXCEPTION if any orphan rows remain.

ALTER TABLE public.client_allowed_products
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_client_allowed_products_account_id
  ON public.client_allowed_products(account_id);

DO $$
DECLARE
  v_count int;
  orphan_count int;
BEGIN
  UPDATE public.client_allowed_products cap
  SET account_id = p.account_id
  FROM public.products p
  WHERE p.id = cap.product_id
    AND cap.account_id IS NULL
    AND p.account_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RAISE NOTICE 'client_allowed_products backfill: % rows updated', v_count;

  SELECT count(*) INTO orphan_count
  FROM public.client_allowed_products
  WHERE account_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Step 3 abort: % client_allowed_products rows have no account_id after backfill', orphan_count;
  END IF;

  RAISE NOTICE 'Step 3 complete';
END;
$$;
