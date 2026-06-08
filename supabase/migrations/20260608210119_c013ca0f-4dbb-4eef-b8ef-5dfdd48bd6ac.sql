
-- 1) Restrict shopify_sources.api_access_token to ADMIN/service_role only.
REVOKE SELECT (api_access_token) ON public.shopify_sources FROM authenticated;
REVOKE SELECT (api_access_token) ON public.shopify_sources FROM anon;

-- All other columns remain readable per existing RLS (ADMIN+OPS).
-- Re-grant non-token columns to authenticated explicitly so column privileges are unambiguous.
GRANT SELECT (id, store_name, store_slug, linked_account_id, store_url, api_scopes,
  token_expires_at, pull_cadence, pull_schedule_cron, default_short_ship_reason,
  is_active, owner_notes, created_at, updated_at)
  ON public.shopify_sources TO authenticated;

-- ADMINs / service_role retain full read including the token (service_role bypasses RLS).
-- For ADMIN access to the token column, expose via a SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION public.get_shopify_source_token(_source_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT api_access_token INTO v_token FROM public.shopify_sources WHERE id = _source_id;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_source_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shopify_source_token(uuid) TO authenticated;

-- 2) Lock down sweep_past_bookings_to_completed: not callable by anon/authenticated.
REVOKE ALL ON FUNCTION public.sweep_past_bookings_to_completed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_past_bookings_to_completed() TO service_role;
