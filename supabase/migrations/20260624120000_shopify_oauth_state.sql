-- Shopify OAuth (authorization code grant) state storage + hardening.
--
-- Adds the single-use CSRF state columns used by shopify-oauth-start /
-- shopify-oauth-callback. Columns added with IF NOT EXISTS because some
-- (api_access_token, api_scopes, token_expires_at) were created out-of-band
-- and may already exist.

ALTER TABLE public.shopify_sources
  ADD COLUMN IF NOT EXISTS oauth_state text,
  ADD COLUMN IF NOT EXISTS oauth_state_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS api_access_token text,
  ADD COLUMN IF NOT EXISTS api_scopes text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

-- oauth_state is a short-lived CSRF nonce; keep it server-side only. All OAuth
-- writes go through edge functions using the service role (which bypasses RLS),
-- so no new INSERT/UPDATE policy is needed — mirrors quickbooks_connection.
REVOKE SELECT (oauth_state) ON public.shopify_sources FROM authenticated, anon;

-- NOTE: shopify-oauth-callback now stores api_access_token AES-256-GCM encrypted
-- (see supabase/functions/_shared/crypto.ts). The existing
-- get_shopify_source_token(uuid) RPC therefore returns CIPHERTEXT for any
-- OAuth-onboarded source; only edge functions (which hold SHOPIFY_TOKEN_ENC_KEY)
-- can decrypt it. Legacy plaintext shpat_ tokens remain readable as-is.
