-- Step 2: Backfill account_id on orders and products where client_id is set but account_id is null.
-- Uses a two-pass strategy per table:
--   Pass 1 (products only): copy account_id from a sibling row sharing the same client_id.
--   Pass 2: walk user_roles.client_id -> account_users.account_id.
-- Raises EXCEPTION if any orphan rows remain after both passes.
--
-- Expected: 0 rows for orders (all 3 existing rows already have account_id set).
-- Products count depends on admin write history since account_id was added in March 2026.

DO $$
DECLARE
  v_orders_total int := 0;
  v_products_total int := 0;
  orphan_count int;
  v_batch int;
BEGIN

  -- ==================== ORDERS ====================

  -- Pass 1: borrow account_id from a product row sharing the same client_id
  UPDATE public.orders o
  SET account_id = (
    SELECT p.account_id
    FROM public.products p
    WHERE p.client_id = o.client_id
      AND p.account_id IS NOT NULL
    LIMIT 1
  )
  WHERE o.account_id IS NULL
    AND o.client_id IS NOT NULL;
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_orders_total := v_orders_total + v_batch;

  -- Pass 2: walk user_roles -> account_users
  UPDATE public.orders o
  SET account_id = (
    SELECT au.account_id
    FROM public.user_roles ur
    JOIN public.account_users au ON au.user_id = ur.user_id AND au.is_active = true
    WHERE ur.client_id = o.client_id
    LIMIT 1
  )
  WHERE o.account_id IS NULL
    AND o.client_id IS NOT NULL;
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_orders_total := v_orders_total + v_batch;

  RAISE NOTICE 'orders backfill: % rows updated', v_orders_total;

  SELECT count(*) INTO orphan_count
  FROM public.orders
  WHERE client_id IS NOT NULL AND account_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Step 2 abort: % orders rows have client_id but no account_id after backfill', orphan_count;
  END IF;

  -- ==================== PRODUCTS ====================

  -- Pass 1: copy account_id from a sibling product sharing the same client_id
  UPDATE public.products p1
  SET account_id = (
    SELECT p2.account_id
    FROM public.products p2
    WHERE p2.client_id = p1.client_id
      AND p2.account_id IS NOT NULL
      AND p2.id <> p1.id
    LIMIT 1
  )
  WHERE p1.account_id IS NULL
    AND p1.client_id IS NOT NULL;
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_products_total := v_products_total + v_batch;

  -- Pass 2: walk user_roles -> account_users
  UPDATE public.products p
  SET account_id = (
    SELECT au.account_id
    FROM public.user_roles ur
    JOIN public.account_users au ON au.user_id = ur.user_id AND au.is_active = true
    WHERE ur.client_id = p.client_id
    LIMIT 1
  )
  WHERE p.account_id IS NULL
    AND p.client_id IS NOT NULL;
  GET DIAGNOSTICS v_batch = ROW_COUNT;
  v_products_total := v_products_total + v_batch;

  RAISE NOTICE 'products backfill: % rows updated', v_products_total;

  SELECT count(*) INTO orphan_count
  FROM public.products
  WHERE client_id IS NOT NULL AND account_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Step 2 abort: % products rows have client_id but no account_id after backfill', orphan_count;
  END IF;

  RAISE NOTICE 'Step 2 complete: % orders rows, % products rows backfilled', v_orders_total, v_products_total;
END;
$$;
