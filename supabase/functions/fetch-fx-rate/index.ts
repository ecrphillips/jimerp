import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BOC_URL =
  "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Accept service_role calls (pg_cron / scheduler) OR ADMIN user calls (manual refresh)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceRoleKey;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const isAnonKey = anonKey !== "" && token === anonKey;

    if (!isServiceRole && !isAnonKey) {
      const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: roleData } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (roleData?.role !== "ADMIN") {
        return new Response(
          JSON.stringify({ ok: false, error: "ADMIN role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch from Bank of Canada Valet API
    console.log("[fetch-fx-rate] Fetching USD/CAD rate from Bank of Canada");
    const bocRes = await fetch(BOC_URL);
    if (!bocRes.ok) {
      throw new Error(`Bank of Canada API returned ${bocRes.status}`);
    }

    const bocData = await bocRes.json();
    const obs = bocData.observations?.[0];
    if (!obs?.FXUSDCAD?.v) {
      throw new Error("Unexpected response shape from Bank of Canada API");
    }

    const rate = parseFloat(obs.FXUSDCAD.v);
    const date: string = obs.d; // "YYYY-MM-DD"
    const fetchedAt = new Date().toISOString();

    console.log(`[fetch-fx-rate] Rate: ${rate} as of ${date}`);

    const { error: upsertError } = await adminClient
      .from("app_settings")
      .upsert({
        key: "fx_rate_usd_to_cad",
        value_json: { rate, date, source: "bank-of-canada", fetched_at: fetchedAt },
        updated_at: fetchedAt,
      });

    if (upsertError) {
      throw new Error(`DB upsert failed: ${upsertError.message}`);
    }

    console.log("[fetch-fx-rate] Rate upserted successfully");

    return new Response(
      JSON.stringify({ ok: true, rate, date, fetched_at: fetchedAt }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[fetch-fx-rate] Error:", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
