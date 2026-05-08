-- Step 2: Backfill account_id where missing on orders and products
-- Raises EXCEPTION if any rows have client_id but no resolvable account_id.

DO $$
DECLARE
  v_orders_backfilled int := 0;
  v_orders_orphaned   int := 0;
  v_products_pass1    int := 0;
  v_products_pass2    int := 0;
  v_products_orphaned int := 0;
BEGIN

  -- =============================================
  -- ORDERS: backfill account_id
  -- Join path: orders.client_id → user_roles.client_id → account_users.account_id
  -- =============================================
  WITH upd AS (
    UPDATE public.orders o
    SET account_id = au.account_id
    FROM public.user_roles ur
    JOIN public.account_users au ON au.user_id = ur.user_id AND au.is_active = true
    WHERE o.account_id IS NULL
      AND o.client_id IS NOT NULL
      AND ur.client_id = o.client_id
      AND ur.role = 'CLIENT'
    RETURNING o.id
  )
  SELECT count(*) INTO v_orders_backfilled FROM upd;

  SELECT count(*) INTO v_orders_orphaned
  FROM public.orders
  WHERE account_id IS NULL AND client_id IS NOT NULL;

  IF v_orders_orphaned > 0 THEN
    RAISE EXCEPTION 'orders backfill: % rows have client_id but account_id could not be resolved. Stopping.', v_orders_orphaned;
  END IF;

  RAISE NOTICE 'orders backfill: % rows updated', v_orders_backfilled;

  -- =============================================
  -- PRODUCTS: backfill account_id (two passes)
  -- Pass 1: copy from sibling product with same client_id that already has account_id
  -- =============================================
  WITH upd AS (
    UPDATE public.products p
    SET account_id = sibling.account_id
    FROM (
      SELECT DISTINCT ON (client_id) client_id, account_id
      FROM public.products
      WHERE account_id IS NOT NULL
      ORDER BY client_id, created_at
    ) sibling
    WHERE p.account_id IS NULL
      AND p.client_id IS NOT NULL
      AND sibling.client_id = p.client_id
    RETURNING p.id
  )
  SELECT count(*) INTO v_products_pass1 FROM upd;

  -- Pass 2: walk user_roles → account_users for any remaining rows
  WITH upd AS (
    UPDATE public.products p
    SET account_id = au.account_id
    FROM public.user_roles ur
    JOIN public.account_users au ON au.user_id = ur.user_id AND au.is_active = true
    WHERE p.account_id IS NULL
      AND p.client_id IS NOT NULL
      AND ur.client_id = p.client_id
      AND ur.role = 'CLIENT'
    RETURNING p.id
  )
  SELECT count(*) INTO v_products_pass2 FROM upd;

  SELECT count(*) INTO v_products_orphaned
  FROM public.products
  WHERE account_id IS NULL AND client_id IS NOT NULL;

  IF v_products_orphaned > 0 THEN
    RAISE EXCEPTION 'products backfill: % rows have client_id but account_id could not be resolved. Stopping.', v_products_orphaned;
  END IF;

  RAISE NOTICE 'products backfill: % rows updated (pass1=%, pass2=%)', v_products_pass1 + v_products_pass2, v_products_pass1, v_products_pass2;

END;
$$;
