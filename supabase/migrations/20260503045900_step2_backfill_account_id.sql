-- Step 2: Backfill account_id on orders and products where client_id is set but account_id is NULL.
--
-- Join path for both tables:
--   Pass 1 (products self-join): match products rows that share the same client_id and already
--           have account_id set. This is the most reliable path since admin writes set both.
--   Pass 2 (user_roles → account_users): for any remaining orphans, walk the user tables.
--   After both passes, raise an exception if any rows are still unmapped so the migration
--   does not silently proceed with dangling NULLs.
--
-- For orders: the live audit confirmed all 3 existing rows already have account_id set.
-- This migration is expected to report 0 backfilled for orders and serves as a safety net.

DO $$
DECLARE
  v_orders_backfilled   int := 0;
  v_products_pass1      int := 0;
  v_products_pass2      int := 0;
  v_orders_orphans      int := 0;
  v_products_orphans    int := 0;
BEGIN

  -- ============================================================
  -- ORDERS: Pass 1 — via products that share the same client_id
  -- ============================================================
  WITH upd AS (
    UPDATE public.orders o
    SET account_id = p.account_id
    FROM (
      SELECT DISTINCT ON (client_id) client_id, account_id
      FROM public.products
      WHERE account_id IS NOT NULL AND client_id IS NOT NULL
    ) p
    WHERE o.client_id = p.client_id
      AND o.account_id IS NULL
      AND o.client_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_orders_backfilled FROM upd;

  -- ORDERS: Pass 2 — via user_roles → account_users for anything still unmapped
  WITH upd AS (
    UPDATE public.orders o
    SET account_id = au.account_id
    FROM public.user_roles ur
    JOIN public.account_users au
      ON au.user_id = ur.user_id AND au.is_active = true
    WHERE ur.client_id = o.client_id
      AND o.account_id IS NULL
      AND o.client_id IS NOT NULL
    RETURNING 1
  )
  SELECT v_orders_backfilled + count(*) INTO v_orders_backfilled FROM upd;

  SELECT count(*) INTO v_orders_orphans
  FROM public.orders
  WHERE account_id IS NULL AND client_id IS NOT NULL;

  RAISE NOTICE 'orders: % rows backfilled, % orphans remaining', v_orders_backfilled, v_orders_orphans;

  IF v_orders_orphans > 0 THEN
    RAISE EXCEPTION
      'orders backfill incomplete: % row(s) have client_id set but no matching account_id. '
      'Resolve the clients→accounts mapping before proceeding.',
      v_orders_orphans;
  END IF;

  -- ============================================================
  -- PRODUCTS: Pass 1 — self-join on client_id
  -- ============================================================
  WITH upd AS (
    UPDATE public.products p
    SET account_id = existing.account_id
    FROM (
      SELECT DISTINCT ON (client_id) client_id, account_id
      FROM public.products
      WHERE account_id IS NOT NULL AND client_id IS NOT NULL
    ) existing
    WHERE p.client_id = existing.client_id
      AND p.account_id IS NULL
      AND p.client_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_products_pass1 FROM upd;

  -- PRODUCTS: Pass 2 — via user_roles → account_users for remaining unmapped rows
  WITH upd AS (
    UPDATE public.products p
    SET account_id = au.account_id
    FROM public.user_roles ur
    JOIN public.account_users au
      ON au.user_id = ur.user_id AND au.is_active = true
    WHERE ur.client_id = p.client_id
      AND p.account_id IS NULL
      AND p.client_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_products_pass2 FROM upd;

  SELECT count(*) INTO v_products_orphans
  FROM public.products
  WHERE account_id IS NULL AND client_id IS NOT NULL;

  RAISE NOTICE 'products: % rows backfilled (pass1=%, pass2=%), % orphans remaining',
    v_products_pass1 + v_products_pass2, v_products_pass1, v_products_pass2, v_products_orphans;

  IF v_products_orphans > 0 THEN
    RAISE EXCEPTION
      'products backfill incomplete: % row(s) have client_id set but no matching account_id. '
      'Resolve the clients→accounts mapping before proceeding.',
      v_products_orphans;
  END IF;

END;
$$;
