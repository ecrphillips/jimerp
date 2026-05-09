import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";

// TODO: Deploy this function via `supabase functions deploy confirm-order-email`
// before the email trigger in OrderEditModal.tsx goes live.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FROM_ADDRESS = "noreply@homeislandcoffee.com";
const FROM_DISPLAY = "Home Island Manufacturing <noreply@homeislandcoffee.com>";
const CC_ADDRESS = "orders@homeislandcoffee.com";

// TODO: Confirm that the enqueue_email RPC payload supports a `cc` field.
// If the RPC / process-email-queue function does not forward `cc` to Resend,
// either extend the RPC payload schema or send a second enqueue call to CC_ADDRESS.

interface ConfirmRequest {
  order_id: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ========== AUTHENTICATION ==========
    // Only ADMIN/OPS users can change order status to CONFIRMED, so we verify
    // the caller is authenticated with an internal role.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      console.error("[confirm-order-email] Invalid token:", authError?.message);
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

    if (!roleData || !["ADMIN", "OPS"].includes(roleData.role)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Forbidden — internal role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { order_id }: ConfirmRequest = await req.json();
    if (!order_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "order_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[confirm-order-email] Processing order_id=${order_id}`);

    // ========== FETCH ORDER ==========
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id, order_number, requested_ship_date, work_deadline_at, account_id, status")
      .eq("id", order_id)
      .maybeSingle();

    if (orderError || !order) {
      console.error("[confirm-order-email] Order not found:", orderError?.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (order.status !== "CONFIRMED") {
      console.warn(`[confirm-order-email] Order ${order_id} status is ${order.status}, not CONFIRMED — skipping`);
      return new Response(
        JSON.stringify({ ok: false, error: "Order is not in CONFIRMED status" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== FETCH ACCOUNT ==========
    // TODO: Verify the accounts table has `billing_email` and `account_name` populated
    // for this account before going live. If billing_email is null, the email will be skipped.
    const { data: account, error: accountError } = await adminClient
      .from("accounts")
      .select("account_name, billing_email")
      .eq("id", order.account_id)
      .maybeSingle();

    if (accountError || !account) {
      console.error("[confirm-order-email] Account not found for order:", order_id);
      return new Response(
        JSON.stringify({ ok: false, error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!account.billing_email) {
      console.warn(`[confirm-order-email] Account ${order.account_id} has no billing_email — cannot send`);
      return new Response(
        JSON.stringify({ ok: false, error: "Account has no billing email" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========== FETCH LINE ITEMS ==========
    const { data: lineItems, error: lineError } = await adminClient
      .from("order_line_items")
      .select("quantity_units, product:products(product_name)")
      .eq("order_id", order_id)
      .order("created_at", { ascending: true });

    if (lineError) {
      console.error("[confirm-order-email] Failed to fetch line items:", lineError.message);
    }

    // ========== BUILD EMAIL BODY ==========
    const accountName = account.account_name;
    const orderNumber = order.order_number;
    const roastDay = formatDate(order.work_deadline_at);
    const shipDate = formatDate(order.requested_ship_date);

    const itemLines = (lineItems ?? [])
      .map((li) => {
        // deno-lint-ignore no-explicit-any
        const productName = (li.product as any)?.product_name ?? "Unknown Product";
        return `  * ${productName} — ${li.quantity_units} units`;
      })
      .join("\n");

    const emailText = `Hi ${accountName},

Your order has been confirmed. Here are the details:

Order Number: ${orderNumber}
Planned Roast Day: ${roastDay}
Requested Ship Date: ${shipDate}

Items:
${itemLines || "  (No items)"}

If you have any questions, reply to this email or contact us at orders@homeislandcoffee.com.

Thank you,
Home Island Manufacturing`;

    const subject = `Order Confirmed — ${orderNumber} — ${accountName}`;

    // ========== ENQUEUE EMAIL ==========
    const messageId = crypto.randomUUID();

    await adminClient.from("email_send_log").insert({
      message_id: messageId,
      template_name: "order_confirmation",
      recipient_email: account.billing_email,
      status: "pending",
    });

    const { error: enqueueError } = await adminClient.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: messageId,
        to: account.billing_email,
        // TODO: Verify enqueue_email RPC and process-email-queue forward `cc` to Resend.
        // If not supported yet, remove this field and handle CC separately.
        cc: CC_ADDRESS,
        from: FROM_DISPLAY,
        sender_domain: FROM_ADDRESS.split("@")[1],
        subject,
        text: emailText,
        purpose: "transactional",
        label: "order_confirmation",
        queued_at: new Date().toISOString(),
      },
    });

    if (enqueueError) {
      console.error("[confirm-order-email] Failed to enqueue:", enqueueError.message);
      await adminClient.from("email_send_log").insert({
        message_id: messageId,
        template_name: "order_confirmation",
        recipient_email: account.billing_email,
        status: "failed",
        error_message: "Failed to enqueue",
      });
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to enqueue email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[confirm-order-email] Enqueued confirmation for order ${orderNumber} → ${account.billing_email}`);

    return new Response(
      JSON.stringify({ ok: true, message_id: messageId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[confirm-order-email] Unhandled error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
