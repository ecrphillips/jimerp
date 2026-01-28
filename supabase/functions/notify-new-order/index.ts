import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotifyRequest {
  order_id: string;
  test?: boolean;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ========== AUTHENTICATION ==========
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[notify-new-order] Missing authorization header");
      return new Response(
        JSON.stringify({ ok: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      console.error("[notify-new-order] Invalid token:", authError?.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== AUTHORIZATION ==========
    const { data: roleData, error: roleError } = await adminClient
      .from("user_roles")
      .select("role, client_id")
      .eq("user_id", user.id)
      .single();

    if (roleError || !roleData) {
      console.error("[notify-new-order] No role found for user:", user.id);
      return new Response(
        JSON.stringify({ ok: false, error: "No role assigned" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { order_id, test = false }: NotifyRequest = await req.json();

    if (!order_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "order_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[notify-new-order] Processing order_id=${order_id}, test=${test}, user=${user.id}, role=${roleData.role}`);

    // Fetch order details first to verify access
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select(`
        id,
        order_number,
        work_deadline,
        client_id,
        client:clients(id, name)
      `)
      .eq("id", order_id)
      .maybeSingle();

    if (orderError || !order) {
      console.error("[notify-new-order] Order not found:", orderError?.message || "No data");
      return new Response(
        JSON.stringify({ ok: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== ROLE-BASED ACCESS CHECK ==========
    const isInternal = roleData.role === "ADMIN" || roleData.role === "OPS";
    
    // If CLIENT role, verify they own this order
    if (roleData.role === "CLIENT") {
      if (order.client_id !== roleData.client_id) {
        console.error("[notify-new-order] CLIENT user attempted to access order from different client:", {
          user_id: user.id,
          user_client_id: roleData.client_id,
          order_client_id: order.client_id
        });
        return new Response(
          JSON.stringify({ ok: false, error: "Forbidden - you can only notify for your own orders" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // order.client from a select with join returns an object (not array) when single-relation
    // deno-lint-ignore no-explicit-any
    const clientData = order.client as any;
    const clientName = clientData?.name || "Unknown Client";

    // Insert notification record (this triggers realtime for OPS/ADMIN users)
    const { error: notifError } = await adminClient
      .from("order_notifications")
      .insert({
        order_id: order.id,
        client_name: clientName,
        order_number: order.order_number,
        work_deadline: order.work_deadline,
      });

    if (notifError) {
      console.error("[notify-new-order] Failed to insert notification:", notifError.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to create notification" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[notify-new-order] Notification created successfully by", isInternal ? "internal user" : "client user");

    return new Response(
      JSON.stringify({ 
        ok: true, 
        notification_created: true,
        order_number: order.order_number,
        client_name: clientName,
        test,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notify-new-order] Unexpected error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
