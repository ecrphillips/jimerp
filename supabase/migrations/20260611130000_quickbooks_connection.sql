-- QuickBooks Online (SANDBOX) connection — single-row table holding the OAuth
-- tokens for our own company. Tokens are written only by SECURITY DEFINER-less
-- edge functions using the service role; the frontend can read status columns
-- only (column-level grants exclude access_token / refresh_token / oauth_state).

CREATE TABLE public.quickbooks_connection (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment = 'sandbox'),
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connected', 'needs_reconnect')),
  access_token text,
  refresh_token text,
  realm_id text,
  company_name text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  connected_at timestamptz,
  oauth_state text,
  oauth_state_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the singleton row so edge functions can always UPDATE id = 1.
INSERT INTO public.quickbooks_connection (id) VALUES (1);

ALTER TABLE public.quickbooks_connection ENABLE ROW LEVEL SECURITY;

-- ADMIN only may read. No OPS, no CLIENT.
CREATE POLICY "Admins can view QuickBooks connection"
  ON public.quickbooks_connection
  FOR SELECT
  USING (public.has_role(auth.uid(), 'ADMIN'::app_role));

-- No INSERT/UPDATE/DELETE policies on purpose: all writes go through edge
-- functions using the service role (which bypasses RLS).

-- Column-level lockdown: even ADMINs reading from the browser never see the
-- tokens or the OAuth state — only the status columns below are selectable.
REVOKE ALL ON public.quickbooks_connection FROM anon, authenticated;
GRANT SELECT (
  id,
  environment,
  status,
  realm_id,
  company_name,
  token_expires_at,
  refresh_token_expires_at,
  connected_at,
  updated_at
) ON public.quickbooks_connection TO authenticated;
