// quickbooks-oauth-start — builds the Intuit (SANDBOX) authorization URL and
// returns it to the admin UI, which redirects the browser to Intuit.
// ADMIN only. A random `state` is stored on the connection row for CSRF
// validation in quickbooks-oauth-callback.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import {
  getServiceClient,
  requireAdmin,
  getRedirectUri,
  getIntuitCredentials,
  INTUIT_AUTH_URL,
  QBO_SCOPE,
} from "../_shared/quickbooks.ts";

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = getServiceClient();
    const auth = await requireAdmin(req, supabase, corsHeaders);
    if ("response" in auth) return auth.response;

    const { clientId } = getIntuitCredentials();
    const state = crypto.randomUUID();

    const { error } = await supabase
      .from("quickbooks_connection")
      .update({
        oauth_state: state,
        oauth_state_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw error;

    const url = new URL(INTUIT_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", QBO_SCOPE);
    url.searchParams.set("redirect_uri", getRedirectUri());
    url.searchParams.set("state", state);

    return new Response(JSON.stringify({ ok: true, url: url.toString() }), {
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error("quickbooks-oauth-start error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
