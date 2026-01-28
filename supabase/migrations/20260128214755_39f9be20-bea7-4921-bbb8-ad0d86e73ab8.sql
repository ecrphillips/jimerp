-- =============================================
-- ADD EXPLICIT DENIAL FOR ANONYMOUS USERS
-- These policies ensure unauthenticated users get nothing
-- =============================================

-- PROFILES: Explicit deny for anon (belt and suspenders)
CREATE POLICY "Deny anonymous access to profiles"
ON public.profiles
FOR SELECT
TO anon
USING (false);

-- CLIENTS: Explicit deny for anon
CREATE POLICY "Deny anonymous access to clients"
ON public.clients
FOR SELECT
TO anon
USING (false);

-- ORDERS: Explicit deny for anon  
CREATE POLICY "Deny anonymous access to orders"
ON public.orders
FOR SELECT
TO anon
USING (false);

-- USER_ROLES: Explicit deny for anon
CREATE POLICY "Deny anonymous access to user_roles"
ON public.user_roles
FOR SELECT
TO anon
USING (false);

-- PRICE_LIST: Explicit deny for anon
CREATE POLICY "Deny anonymous access to price_list"
ON public.price_list
FOR SELECT
TO anon
USING (false);

-- ORDER_LINE_ITEMS: Explicit deny for anon
CREATE POLICY "Deny anonymous access to order_line_items"
ON public.order_line_items
FOR SELECT
TO anon
USING (false);

-- PRODUCTS: Explicit deny for anon
CREATE POLICY "Deny anonymous access to products"
ON public.products
FOR SELECT
TO anon
USING (false);