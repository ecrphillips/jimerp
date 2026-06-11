// quickbooks-test-connection — harmless end-to-end check. Refreshes the token
// if needed, then reads CompanyInfo from the QBO SANDBOX API and returns the
// company name (also cached on the connection row for the admin UI).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import {
  getServiceClient,
  requireAdmin,
  ensureFreshToken,
  QBO_API_BASE,
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

    const token = await ensureFreshToken(supabase);
    if (!token.ok) {
      return new Response(
        JSON.stringify({ ok: false, status: token.reason }),
        { headers: jsonHeaders },
      );
    }

    const res = await fetch(
      `${QBO_API_BASE}/v3/company/${token.realmId}/companyinfo/${token.realmId}?minorversion=75`,
      {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: "application/json",
        },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("CompanyInfo request failed:", res.status, text);
      return new Response(
        JSON.stringify({ ok: false, error: `QBO CompanyInfo returned ${res.status}` }),
        { status: 502, headers: jsonHeaders },
      );
    }

    const payload = await res.json();
    const companyName: string | null = payload?.CompanyInfo?.CompanyName ?? null;

    if (companyName) {
      await supabase
        .from("quickbooks_connection")
        .update({ company_name: companyName, updated_at: new Date().toISOString() })
        .eq("id", 1);
    }

    return new Response(
      JSON.stringify({ ok: true, companyName, realmId: token.realmId }),
      { headers: jsonHeaders },
    );
  } catch (err) {
    console.error("quickbooks-test-connection error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
