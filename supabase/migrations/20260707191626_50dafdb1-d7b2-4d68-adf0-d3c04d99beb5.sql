
-- =========================================================================
-- Fix 1 & 2: Consolidate client_unit_economics_scenarios policies
-- Remove overly-permissive account-wide write policies and duplicate admin.
-- Keep ownership-scoped "Clients can ..." policies and a single has_role()
-- admin policy.
-- =========================================================================
DROP POLICY IF EXISTS "Account users can insert own scenarios" ON public.client_unit_economics_scenarios;
DROP POLICY IF EXISTS "Account users can update own scenarios" ON public.client_unit_economics_scenarios;
DROP POLICY IF EXISTS "Account users can delete own scenarios" ON public.client_unit_economics_scenarios;
DROP POLICY IF EXISTS "Account users can view own scenarios" ON public.client_unit_economics_scenarios;
DROP POLICY IF EXISTS "Admins and Ops can manage all client scenarios" ON public.client_unit_economics_scenarios;

-- =========================================================================
-- Fix 3: Replace security-definer-behaving view with security_invoker view.
-- Also adjust the restrictive "hide cancelled" policy so staff can still see
-- cancelled orders through both the base table and the view.
-- =========================================================================
DROP POLICY IF EXISTS "Cancelled orders hidden by default" ON public.orders;
CREATE POLICY "Cancelled orders hidden by default"
  ON public.orders
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    status <> 'CANCELLED'::public.order_status
    OR public.has_role(auth.uid(), 'ADMIN'::public.app_role)
    OR public.has_role(auth.uid(), 'OPS'::public.app_role)
  );

DROP VIEW IF EXISTS public.orders_all;
CREATE VIEW public.orders_all
WITH (security_invoker = true)
AS
SELECT o.*
FROM public.orders o
WHERE public.has_role(auth.uid(), 'ADMIN'::public.app_role)
   OR public.has_role(auth.uid(), 'OPS'::public.app_role);

COMMENT ON VIEW public.orders_all IS
  'Staff-only opt-in read of orders INCLUDING cancelled. Runs with the caller''s permissions (security_invoker); the restrictive orders policy grants staff visibility into cancelled rows.';

REVOKE ALL ON public.orders_all FROM PUBLIC, anon;
GRANT SELECT ON public.orders_all TO authenticated;
