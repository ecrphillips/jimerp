-- Step 4: Replace all CLIENT-facing RLS policies that gate via get_user_client_id()
-- with the canonical account_users predicate:
--
--   EXISTS (
--     SELECT 1 FROM public.account_users au
--     WHERE au.account_id = <table>.account_id
--       AND au.user_id = auth.uid()
--       AND au.is_active = true
--   )
--
-- ADMIN/OPS policies and anon-denial policies are left untouched.

-- ============================================================
-- 1. orders (4 CLIENT policies → 4 new)
-- ============================================================
DROP POLICY IF EXISTS "Clients can view own orders"                  ON public.orders;
DROP POLICY IF EXISTS "Clients can create own orders"                ON public.orders;
DROP POLICY IF EXISTS "Clients can update own draft/submitted orders" ON public.orders;
DROP POLICY IF EXISTS "Clients can cancel own submitted orders"      ON public.orders;

CREATE POLICY "Clients can view own orders"
ON public.orders
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = orders.account_id
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
  )
);

CREATE POLICY "Clients can create own orders"
ON public.orders
AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = orders.account_id
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
  )
);

CREATE POLICY "Clients can update own draft/submitted orders"
ON public.orders
AS PERMISSIVE FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = orders.account_id
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
  )
  AND status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = orders.account_id
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
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
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
  )
  AND status = 'SUBMITTED'::public.order_status
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = orders.account_id
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
  )
  AND status = 'CANCELLED'::public.order_status
);

-- ============================================================
-- 2. order_line_items (2 CLIENT policies → 2 new)
-- ============================================================
DROP POLICY IF EXISTS "Clients can view own order line items"   ON public.order_line_items;
DROP POLICY IF EXISTS "Clients can manage own order line items" ON public.order_line_items;

CREATE POLICY "Clients can view own order line items"
ON public.order_line_items
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.account_users au ON au.account_id = o.account_id
    WHERE o.id         = order_line_items.order_id
      AND au.user_id   = auth.uid()
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
    WHERE o.id         = order_line_items.order_id
      AND au.user_id   = auth.uid()
      AND au.is_active = true
      AND o.status = ANY (ARRAY['DRAFT'::public.order_status, 'SUBMITTED'::public.order_status])
  )
);

-- ============================================================
-- 3. products (1 CLIENT policy → 1 new)
-- ============================================================
DROP POLICY IF EXISTS "Clients can view own products" ON public.products;

CREATE POLICY "Clients can view own products"
ON public.products
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = products.account_id
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
  )
  AND is_active = true
);

-- ============================================================
-- 4. price_list (1 CLIENT policy → 1 new)
-- ============================================================
DROP POLICY IF EXISTS "Clients can view own product prices" ON public.price_list;

CREATE POLICY "Clients can view own product prices"
ON public.price_list
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.account_users au ON au.account_id = p.account_id
    WHERE p.id         = price_list.product_id
      AND au.user_id   = auth.uid()
      AND au.is_active = true
  )
);

-- ============================================================
-- 5. clients — drop CLIENT policy, no replacement
-- CLIENT users have no SELECT access to the clients table.
-- Admin/Ops policies remain for internal reads.
-- ============================================================
DROP POLICY IF EXISTS "Clients can view only own client" ON public.clients;

-- ============================================================
-- 6. client_locations — drop CLIENT policy, no replacement
-- CLIENT users have no SELECT access to client_locations.
-- Client-facing reads use account_locations instead.
-- ============================================================
DROP POLICY IF EXISTS "Clients can view their own locations" ON public.client_locations;

-- ============================================================
-- 7. client_allowed_products (1 CLIENT policy → 1 new)
-- ============================================================
DROP POLICY IF EXISTS "Clients can view their allowed products" ON public.client_allowed_products;

CREATE POLICY "Clients can view their allowed products"
ON public.client_allowed_products
AS PERMISSIVE FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_users au
    WHERE au.account_id = client_allowed_products.account_id
      AND au.user_id    = auth.uid()
      AND au.is_active  = true
  )
);
