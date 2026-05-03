-- Step 4: Retire get_user_client_id()-based CLIENT RLS policies on all 7 dependent tables.
-- Replace with account_users canonical predicate:
--   EXISTS (SELECT 1 FROM account_users au WHERE au.account_id = <table>.account_id
--             AND au.user_id = auth.uid() AND au.is_active = true)
--
-- Tables touched: orders, order_line_items, products, price_list,
--                 clients (deny CLIENT outright), client_locations (deny CLIENT outright),
--                 client_allowed_products (new account_id column from Step 3).
-- ADMIN/OPS policies and anon-denial policies are NOT modified.


-- ==================== ORDERS ====================

DROP POLICY IF EXISTS "Clients can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Clients can create own orders" ON public.orders;
DROP POLICY IF EXISTS "Clients can update own draft/submitted orders" ON public.orders;
DROP POLICY IF EXISTS "Clients can cancel own submitted orders" ON public.orders;

CREATE POLICY "Clients can view own orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = orders.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

CREATE POLICY "Clients can create own orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = orders.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

CREATE POLICY "Clients can update own draft/submitted orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = orders.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
    AND status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = orders.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
    AND status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
  );

-- USING: current status must be SUBMITTED; WITH CHECK: new status must be CANCELLED
CREATE POLICY "Clients can cancel own submitted orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = orders.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
    AND status = 'SUBMITTED'::public.order_status
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = orders.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
    AND status = 'CANCELLED'::public.order_status
  );


-- ==================== ORDER_LINE_ITEMS ====================

DROP POLICY IF EXISTS "Clients can view own order line items" ON public.order_line_items;
DROP POLICY IF EXISTS "Clients can manage own order line items" ON public.order_line_items;

CREATE POLICY "Clients can view own order line items"
  ON public.order_line_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.account_users au ON au.account_id = o.account_id
      WHERE o.id = order_line_items.order_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );

CREATE POLICY "Clients can manage own order line items"
  ON public.order_line_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.account_users au ON au.account_id = o.account_id
      WHERE o.id = order_line_items.order_id
        AND o.status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );


-- ==================== PRODUCTS ====================

DROP POLICY IF EXISTS "Clients can view own products" ON public.products;

CREATE POLICY "Clients can view own products"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = products.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
    AND is_active = true
  );


-- ==================== PRICE_LIST ====================

DROP POLICY IF EXISTS "Clients can view own product prices" ON public.price_list;

CREATE POLICY "Clients can view own product prices"
  ON public.price_list
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      JOIN public.account_users au ON au.account_id = p.account_id
      WHERE p.id = price_list.product_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );


-- ==================== CLIENTS ====================
-- Deny CLIENT role entirely. account-side data lives in accounts/account_users.
-- ADMIN/OPS policies ("Admin/Ops can view all clients", "Admin can manage clients",
-- "Ops can update clients") are NOT modified.

DROP POLICY IF EXISTS "Clients can view only own client" ON public.clients;


-- ==================== CLIENT_LOCATIONS ====================
-- account_locations is the account-side replacement; deny CLIENT on this legacy table.
-- Admin/OPS "Admin/Ops can manage client locations" policy is NOT modified.

DROP POLICY IF EXISTS "Clients can view their own locations" ON public.client_locations;


-- ==================== CLIENT_ALLOWED_PRODUCTS ====================
-- account_id column was added in Step 3 migration.

DROP POLICY IF EXISTS "Clients can view their allowed products" ON public.client_allowed_products;

CREATE POLICY "Clients can view their allowed products"
  ON public.client_allowed_products
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.account_users au
      WHERE au.account_id = client_allowed_products.account_id
        AND au.user_id = auth.uid()
        AND au.is_active = true
    )
  );
