// quickbooks-token-refresh — checks token expiry and refreshes the access
// token via the refresh token when needed. ADMIN only when called over HTTP;
// other edge functions should import ensureFreshToken from
// ../_shared/quickbooks.ts directly instead of calling this endpoint.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import { getServiceClient, requireAdmin, ensureFreshToken } from "../_shared/quickbooks.ts";

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

    const result = await ensureFreshToken(supabase);
    if (!result.ok) {
      return new Response(
        JSON.stringify({ ok: false, status: result.reason }),
        { headers: jsonHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status: "connected",
        token_expires_at: result.tokenExpiresAt,
      }),
      { headers: jsonHeaders },
    );
  } catch (err) {
    console.error("quickbooks-token-refresh error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
