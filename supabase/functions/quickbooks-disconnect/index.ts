// quickbooks-disconnect — revokes the refresh token at Intuit (best effort)
// and clears the stored tokens, returning the connection to "disconnected".
// ADMIN only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import {
  getServiceClient,
  requireAdmin,
  getConnection,
  revokeToken,
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

    const conn = await getConnection(supabase);
    if (conn?.refresh_token) {
      try {
        await revokeToken(conn.refresh_token);
      } catch (err) {
        // Best effort — still clear local tokens even if Intuit revoke fails.
        console.error("Intuit token revoke failed (continuing):", err);
      }
    }

    const { error } = await supabase
      .from("quickbooks_connection")
      .update({
        status: "disconnected",
        access_token: null,
        refresh_token: null,
        realm_id: null,
        company_name: null,
        token_expires_at: null,
        refresh_token_expires_at: null,
        connected_at: null,
        oauth_state: null,
        oauth_state_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, status: "disconnected" }), {
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error("quickbooks-disconnect error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
