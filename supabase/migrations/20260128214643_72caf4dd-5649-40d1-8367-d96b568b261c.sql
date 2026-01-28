-- =============================================
-- FIX 1: PROFILES TABLE - Explicit RLS policies
-- =============================================

-- Drop existing policies on profiles
DROP POLICY IF EXISTS "Admin can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin/Ops can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view/update own profile" ON public.profiles;

-- Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owner as well (prevents bypassing)
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

-- Policy 1: Users can SELECT only their own profile
CREATE POLICY "Users can select own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy 2: ADMIN/OPS can SELECT all profiles (more specific, takes precedence for these roles)
CREATE POLICY "Admin/Ops can select all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'ADMIN'::app_role) OR 
  has_role(auth.uid(), 'OPS'::app_role)
);

-- Policy 3: Users can UPDATE only their own profile
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy 4: ADMIN can INSERT/UPDATE/DELETE all profiles
CREATE POLICY "Admin can manage all profiles"
ON public.profiles
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'ADMIN'::app_role))
WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

-- =============================================
-- FIX 2: CLIENTS TABLE - Explicit RLS policies  
-- =============================================

-- Drop existing policies on clients
DROP POLICY IF EXISTS "Admin can manage clients" ON public.clients;
DROP POLICY IF EXISTS "Admin/Ops can view all clients" ON public.clients;
DROP POLICY IF EXISTS "Clients can view own client" ON public.clients;
DROP POLICY IF EXISTS "Ops can update clients" ON public.clients;

-- Ensure RLS is enabled
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owner as well
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;

-- Policy 1: CLIENT users can only SELECT their own associated client
CREATE POLICY "Clients can view only own client"
ON public.clients
FOR SELECT
TO authenticated
USING (
  -- Only if user has CLIENT role and is linked to this specific client
  (has_role(auth.uid(), 'CLIENT'::app_role) AND id = get_user_client_id(auth.uid()))
);

-- Policy 2: ADMIN/OPS can SELECT all clients
CREATE POLICY "Admin/Ops can view all clients"
ON public.clients
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'ADMIN'::app_role) OR 
  has_role(auth.uid(), 'OPS'::app_role)
);

-- Policy 3: ADMIN can INSERT/UPDATE/DELETE all clients
CREATE POLICY "Admin can manage clients"
ON public.clients
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'ADMIN'::app_role))
WITH CHECK (has_role(auth.uid(), 'ADMIN'::app_role));

-- Policy 4: OPS can UPDATE clients (but not insert/delete)
CREATE POLICY "Ops can update clients"
ON public.clients
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'OPS'::app_role))
WITH CHECK (has_role(auth.uid(), 'OPS'::app_role));