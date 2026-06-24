-- ─────────────────────────────────────────────────────────────────────────────
-- 1) order_status_audit_log — explicit anon deny for clarity/defense-in-depth
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Deny anon order_status_audit_log" ON public.order_status_audit_log;
CREATE POLICY "Deny anon order_status_audit_log"
  ON public.order_status_audit_log
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) quickbooks_connection — explicit anon deny; ADMIN SELECT policy stays
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Deny anon quickbooks_connection" ON public.quickbooks_connection;
CREATE POLICY "Deny anon quickbooks_connection"
  ON public.quickbooks_connection
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) shopify_sources — separate ADMIN/OPS policies AND remove API-credential
--    column access from the authenticated role. Edge functions use the
--    service_role which is unaffected by these REVOKEs.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "shopify_sources_admin_ops" ON public.shopify_sources;

CREATE POLICY "shopify_sources_admin_all"
  ON public.shopify_sources
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'::public.app_role));

CREATE POLICY "shopify_sources_ops_all"
  ON public.shopify_sources
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'OPS'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'OPS'::public.app_role));

CREATE POLICY "Deny anon shopify_sources"
  ON public.shopify_sources
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Column-level lockdown: PostgREST callers (any 'authenticated' user, ADMIN or
-- OPS) cannot read or modify the API credentials directly. Backend writes go
-- through service_role (edge functions), which retains full access.
REVOKE SELECT (api_access_token, oauth_client_id, oauth_client_secret)
  ON public.shopify_sources FROM authenticated;
REVOKE INSERT (api_access_token, oauth_client_id, oauth_client_secret)
  ON public.shopify_sources FROM authenticated;
REVOKE UPDATE (api_access_token, oauth_client_id, oauth_client_secret)
  ON public.shopify_sources FROM authenticated;

GRANT ALL ON public.shopify_sources TO service_role;
