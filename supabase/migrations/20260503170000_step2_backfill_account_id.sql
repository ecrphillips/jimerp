-- Step 2: Backfill account_id where missing on orders and products.
-- Expected: all 3 existing orders already have account_id set per audit (0 backfill).
-- Products: may have null account_id if created before the column was added in March 2026.
--
-- Strategy (two passes for products):
--   Pass 1 — sibling join: copy account_id from a sibling product row with the same client_id.
--   Pass 2 — user_roles walk: products.client_id → user_roles.client_id → account_users.account_id.
-- Raises EXCEPTION on any orphan rows so migration cannot silently proceed.

DO $$
DECLARE
  v_orders_backfilled  integer;
  v_products_pass1     integer;
  v_products_pass2     integer;
  v_orders_orphans     integer;
  v_products_orphans   integer;
BEGIN

  -- ----------------------------------------------------------------
  -- ORDERS: backfill via user_roles → account_users
  -- ----------------------------------------------------------------
  UPDATE public.orders o
  SET account_id = au.account_id
  FROM public.user_roles ur
  JOIN public.account_users au
    ON au.user_id = ur.user_id
   AND au.is_active = true
  WHERE o.account_id IS NULL
    AND o.client_id  IS NOT NULL
    AND ur.client_id = o.client_id
    AND ur.role      = 'CLIENT';

  GET DIAGNOSTICS v_orders_backfilled = ROW_COUNT;
  RAISE NOTICE 'orders: % rows backfilled', v_orders_backfilled;

  SELECT COUNT(*) INTO v_orders_orphans
  FROM public.orders
  WHERE account_id IS NULL AND client_id IS NOT NULL;

  IF v_orders_orphans > 0 THEN
    RAISE EXCEPTION 'orders: % rows have client_id but no account_id could be mapped — migration aborted', v_orders_orphans;
  END IF;

  -- ----------------------------------------------------------------
  -- PRODUCTS: Pass 1 — sibling product sharing same client_id
  -- ----------------------------------------------------------------
  UPDATE public.products p
  SET account_id = sibling.account_id
  FROM (
    SELECT DISTINCT ON (client_id) client_id, account_id
    FROM public.products
    WHERE account_id IS NOT NULL AND client_id IS NOT NULL
    ORDER BY client_id, created_at
  ) sibling
  WHERE p.account_id IS NULL
    AND p.client_id  IS NOT NULL
    AND p.client_id  = sibling.client_id;

  GET DIAGNOSTICS v_products_pass1 = ROW_COUNT;
  RAISE NOTICE 'products pass 1 (sibling): % rows backfilled', v_products_pass1;

  -- PRODUCTS: Pass 2 — user_roles → account_users walk
  UPDATE public.products p
  SET account_id = au.account_id
  FROM public.user_roles ur
  JOIN public.account_users au
    ON au.user_id = ur.user_id
   AND au.is_active = true
  WHERE p.account_id IS NULL
    AND p.client_id  IS NOT NULL
    AND ur.client_id = p.client_id
    AND ur.role      = 'CLIENT';

  GET DIAGNOSTICS v_products_pass2 = ROW_COUNT;
  RAISE NOTICE 'products pass 2 (user_roles): % rows backfilled', v_products_pass2;

  SELECT COUNT(*) INTO v_products_orphans
  FROM public.products
  WHERE account_id IS NULL AND client_id IS NOT NULL;

  IF v_products_orphans > 0 THEN
    RAISE EXCEPTION 'products: % rows have client_id but no account_id could be mapped — migration aborted', v_products_orphans;
  END IF;

  RAISE NOTICE 'Step 2 complete — orders backfilled: %, products backfilled: %',
    v_orders_backfilled, v_products_pass1 + v_products_pass2;

END $$;
