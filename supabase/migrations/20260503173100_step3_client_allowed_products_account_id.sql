-- Step 3: Add account_id to client_allowed_products (no account_allowed_products equivalent exists)
-- Backfills via product_id → products.account_id. Raises EXCEPTION on orphans.

ALTER TABLE public.client_allowed_products
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_client_allowed_products_account_id
  ON public.client_allowed_products(account_id);

DO $$
DECLARE
  v_backfilled int := 0;
  v_orphaned   int := 0;
BEGIN
  -- Backfill: client_allowed_products.product_id → products.account_id
  -- products.account_id is already populated after Step 2.
  WITH upd AS (
    UPDATE public.client_allowed_products cap
    SET account_id = p.account_id
    FROM public.products p
    WHERE cap.account_id IS NULL
      AND cap.product_id = p.id
      AND p.account_id IS NOT NULL
    RETURNING cap.id
  )
  SELECT count(*) INTO v_backfilled FROM upd;

  SELECT count(*) INTO v_orphaned
  FROM public.client_allowed_products
  WHERE account_id IS NULL;

  IF v_orphaned > 0 THEN
    RAISE EXCEPTION 'client_allowed_products backfill: % rows could not be mapped to an account_id. Stopping.', v_orphaned;
  END IF;

  RAISE NOTICE 'client_allowed_products backfill: % rows updated', v_backfilled;
END;
$$;
