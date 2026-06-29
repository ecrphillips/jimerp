
-- 1. shopify_oauth_debug: enable RLS, admin-only
ALTER TABLE public.shopify_oauth_debug ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shopify_oauth_debug FROM anon, authenticated;
GRANT SELECT ON public.shopify_oauth_debug TO authenticated;
GRANT ALL ON public.shopify_oauth_debug TO service_role;
CREATE POLICY "shopify_oauth_debug_admin_select" ON public.shopify_oauth_debug
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role));
CREATE POLICY "shopify_oauth_debug_deny_anon" ON public.shopify_oauth_debug
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

-- 2. shopify_sources: revoke column privileges on sensitive columns from authenticated.
-- Admins must use the SECURITY DEFINER RPC get_shopify_source_token to retrieve tokens.
-- service_role (edge functions) retains full access.
REVOKE SELECT (api_access_token, oauth_client_secret, oauth_state)
  ON public.shopify_sources FROM authenticated;
REVOKE UPDATE (api_access_token, oauth_client_secret, oauth_state)
  ON public.shopify_sources FROM authenticated;
REVOKE INSERT (api_access_token, oauth_client_secret, oauth_state)
  ON public.shopify_sources FROM authenticated;

-- 3. Revoke public/anon EXECUTE on SECURITY DEFINER trigger functions.
-- These are AFTER triggers; they should never be called directly from the API.
REVOKE EXECUTE ON FUNCTION public.fn_wip_ledger_from_roast() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_ledgers_from_pack() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_fg_ledger_from_ship() FROM PUBLIC, anon, authenticated;
