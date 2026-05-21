-- Step 4: Replace all get_user_client_id()-based CLIENT RLS policies
-- with the canonical account_users predicate.
-- ADMIN/OPS policies and anon-denial policies are untouched.

-- =============================================
-- ORDERS
-- =============================================
DROP POLICY IF EXISTS "Clients can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Clients can create own orders" ON public.orders;
DROP POLICY IF EXISTS "Clients can update own draft/submitted orders" ON public.orders;
DROP POLICY IF EXISTS "Clients can cancel own submitted orders" ON public.orders;

CREATE POLICY "Clients can view own orders"
ON public.orders
AS PERMISSIVE FOR SELECT TO authenticated
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
AS PERMISSIVE FOR INSERT TO authenticated
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
AS PERMISSIVE FOR UPDATE TO authenticated
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

CREATE POLICY "Clients can cancel own submitted orders"
ON public.orders
AS PERMISSIVE FOR UPDATE TO authenticated
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

-- =============================================
-- ORDER_LINE_ITEMS
-- =============================================
DROP POLICY IF EXISTS "Clients can view own order line items" ON public.order_line_items;
DROP POLICY IF EXISTS "Clients can manage own order line items" ON public.order_line_items;

CREATE POLICY "Clients can view own order line items"
ON public.order_line_items
AS PERMISSIVE FOR SELECT TO authenticated
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
AS PERMISSIVE FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id = order_line_items.order_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
      AND o.status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
  )
);

-- =============================================
-- PRODUCTS
-- =============================================
DROP POLICY IF EXISTS "Clients can view own products" ON public.products;

CREATE POLICY "Clients can view own products"
ON public.products
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = products.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
  AND is_active = true
);

-- =============================================
-- PRICE_LIST
-- =============================================
DROP POLICY IF EXISTS "Clients can view own product prices" ON public.price_list;

CREATE POLICY "Clients can view own product prices"
ON public.price_list
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.account_users au ON au.account_id = p.account_id
    WHERE p.id = price_list.product_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);

-- =============================================
-- CLIENTS — DENY CLIENT outright
-- legacy table; account_* tables are the replacement for CLIENT-facing reads
-- =============================================
DROP POLICY IF EXISTS "Clients can view only own client" ON public.clients;
DROP POLICY IF EXISTS "Clients can view own client" ON public.clients;
-- No replacement policy: CLIENT role has no access to clients table.

-- =============================================
-- CLIENT_LOCATIONS — DENY CLIENT outright
-- CLIENT-facing reads go through account_locations instead
-- =============================================
DROP POLICY IF EXISTS "Clients can view their own locations" ON public.client_locations;
-- No replacement policy: CLIENT role should use account_locations.

-- =============================================
-- CLIENT_ALLOWED_PRODUCTS
-- =============================================
DROP POLICY IF EXISTS "Clients can view their allowed products" ON public.client_allowed_products;

CREATE POLICY "Clients can view their allowed products"
ON public.client_allowed_products
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_allowed_products.account_id
      AND au.user_id = auth.uid()
      AND au.is_active = true
  )
);
