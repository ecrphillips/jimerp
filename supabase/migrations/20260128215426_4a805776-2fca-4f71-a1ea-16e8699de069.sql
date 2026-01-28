-- =============================================
-- COMPREHENSIVE SECURITY FIX
-- 1. Revoke all public/anon grants on sensitive tables
-- 2. Fix order_notifications INSERT policy
-- 3. Ensure proper table-level security
-- =============================================

-- STEP 1: Revoke ALL privileges from anon and public roles on sensitive tables
-- This ensures RLS is the ONLY access path

REVOKE ALL ON public.profiles FROM anon, public;
REVOKE ALL ON public.clients FROM anon, public;
REVOKE ALL ON public.user_roles FROM anon, public;
REVOKE ALL ON public.orders FROM anon, public;
REVOKE ALL ON public.order_line_items FROM anon, public;
REVOKE ALL ON public.price_list FROM anon, public;
REVOKE ALL ON public.products FROM anon, public;
REVOKE ALL ON public.order_notifications FROM anon, public;

-- Grant only to authenticated role (RLS will control actual access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_list TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_notifications TO authenticated;

-- STEP 2: Fix order_notifications INSERT policy (currently USING (true))
DROP POLICY IF EXISTS "System can insert notifications" ON public.order_notifications;

-- Create proper INSERT policy - only allow authenticated ADMIN/OPS to insert
-- or allow service role (for triggers/functions)
CREATE POLICY "Admin/Ops can insert notifications"
ON public.order_notifications
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'ADMIN'::app_role) OR 
  has_role(auth.uid(), 'OPS'::app_role)
);

-- STEP 3: Ensure user_roles has proper protection
-- Drop and recreate with explicit role-based access
DROP POLICY IF EXISTS "Admin can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
DROP POLICY IF EXISTS "Deny anonymous access to user_roles" ON public.user_roles;

-- Force RLS
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;

-- Users can only SELECT their own role
CREATE POLICY "Users can select own role"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admin can SELECT all roles
CREATE POLICY "Admin can select all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'ADMIN'::app_role));

-- Admin can manage (INSERT/UPDATE/DELETE) all roles
CREATE POLICY "Admin can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'ADMIN'::app_role))
WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

-- STEP 4: Ensure all sensitive tables have FORCE RLS
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.price_list FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_notifications FORCE ROW LEVEL SECURITY;