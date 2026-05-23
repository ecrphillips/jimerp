import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FROM_ADDRESS = "noreply@homeislandcoffee.com";
const FROM_DISPLAY = "Home Island Manufacturing <noreply@homeislandcoffee.com>";
const CC_ADDRESS = "orders@homeislandcoffee.com";

interface ConfirmRequest {
  order_id: string;
}

interface LineItem { product_name: string; quantity_units: number }

interface ShipTo {
  delivery_method: string | null;
  ship_to_name: string | null;
  ship_to_address_line1: string | null;
  ship_to_address_line2: string | null;
  ship_to_city: string | null;
  ship_to_region: string | null;
  ship_to_postal: string | null;
  ship_to_country: string | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatShipTo(ship: ShipTo | null): { text: string; html: string } {
  if (!ship) return { text: "TBD", html: "TBD" };
  const method = ship.delivery_method ? `${ship.delivery_method}` : "Delivery";
  const addrParts = [
    ship.ship_to_name,
    ship.ship_to_address_line1,
    ship.ship_to_address_line2,
    [ship.ship_to_city, ship.ship_to_region, ship.ship_to_postal].filter(Boolean).join(", "),
    ship.ship_to_country,
  ].filter((p) => p && String(p).trim().length > 0) as string[];
  if (addrParts.length === 0) return { text: method, html: escapeHtml(method) };
  return {
    text: `${method}\n${addrParts.join("\n")}`,
    html: `${escapeHtml(method)}<br/>${addrParts.map(escapeHtml).join("<br/>")}`,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

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

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id, order_number, requested_ship_date, work_deadline, work_deadline_at, account_id, status")
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

    const { data: liRows, error: lineError } = await adminClient
      .from("order_line_items")
      .select("quantity_units, product:products(product_name)")
      .eq("order_id", order_id)
      .order("created_at", { ascending: true });

    if (lineError) {
      console.error("[confirm-order-email] Failed to fetch line items:", lineError.message);
    }
    const lineItems: LineItem[] = (liRows ?? []).map((li: { quantity_units: number; product: unknown }) => ({
      // deno-lint-ignore no-explicit-any
      product_name: (li.product as any)?.product_name ?? "Unknown Product",
      quantity_units: li.quantity_units,
    }));

    const { data: shipment } = await adminClient
      .from("order_shipments")
      .select("delivery_method, ship_to_name, ship_to_address_line1, ship_to_address_line2, ship_to_city, ship_to_region, ship_to_postal, ship_to_country")
      .eq("order_id", order_id)
      .order("shipment_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    const ship: ShipTo | null = shipment ?? null;

    const accountName = account.account_name;
    const orderNumber = order.order_number;
    const roastDay = formatDate(order.work_deadline_at ?? order.work_deadline ?? null);
    const shipDate = formatDate(order.requested_ship_date);
    const shipFmt = formatShipTo(ship);

    const itemsText = lineItems.length === 0
      ? "  (no line items)"
      : lineItems.map((li) => `  • ${li.product_name} — ${li.quantity_units} units`).join("\n");

    const subject = `Order Confirmed — ${orderNumber} — ${accountName}`;

    const emailText = `Hi ${accountName},

Your order has been confirmed. Here are the details:

Order number: ${orderNumber}
Account: ${accountName}
Planned roast day: ${roastDay}
Requested ship date: ${shipDate}

Items:
${itemsText}

Delivery:
${shipFmt.text}

If you need to make changes, contact us at orders@homeislandcoffee.com.

Thank you,
Home Island Manufacturing`;

    const itemRowsHtml = lineItems.length === 0
      ? `<tr><td colspan="2" style="padding:6px 0;color:#666;">(no line items)</td></tr>`
      : lineItems
          .map(
            (li) =>
              `<tr><td style="padding:4px 12px 4px 0;">${escapeHtml(li.product_name)}</td>` +
              `<td style="padding:4px 0;text-align:right;">${li.quantity_units} units</td></tr>`,
          )
          .join("");

    const emailHtml = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#333;margin:0 0 16px 0;">${escapeHtml(subject)}</h2>
  <p style="margin:0 0 16px 0;">Hi ${escapeHtml(accountName)}, your order has been confirmed.</p>
  <table style="border-collapse:collapse;margin:0 0 16px 0;">
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Order number</td><td style="padding:2px 0;"><strong>${escapeHtml(orderNumber)}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Account</td><td style="padding:2px 0;">${escapeHtml(accountName)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Planned roast day</td><td style="padding:2px 0;">${escapeHtml(roastDay)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Requested ship date</td><td style="padding:2px 0;">${escapeHtml(shipDate)}</td></tr>
  </table>
  <h3 style="margin:16px 0 8px 0;font-size:14px;">Items</h3>
  <table style="border-collapse:collapse;width:100%;margin:0 0 16px 0;border-top:1px solid #eee;border-bottom:1px solid #eee;">${itemRowsHtml}</table>
  <h3 style="margin:16px 0 8px 0;font-size:14px;">Delivery</h3>
  <p style="margin:0 0 16px 0;">${shipFmt.html}</p>
  <p style="margin:16px 0 8px 0;color:#666;font-size:13px;">If you need to make changes, contact us at <a href="mailto:orders@homeislandcoffee.com">orders@homeislandcoffee.com</a>.</p>
  <p style="margin:0;color:#666;font-size:13px;">Thank you,<br/>Home Island Manufacturing</p>
</body></html>`;

    // CC strategy: process-email-queue / sendLovableEmail does NOT forward `cc`,
    // so enqueue a second message directly to the orders inbox.
    const senderDomain = FROM_ADDRESS.split("@")[1];

    async function enqueueOne(recipient: string): Promise<{ ok: boolean; message_id: string; error?: string }> {
      const messageId = crypto.randomUUID();
      const { data: logRow } = await adminClient
        .from("email_send_log")
        .insert({
          message_id: messageId,
          template_name: "order_confirmation",
          recipient_email: recipient,
          status: "pending",
        })
        .select("id")
        .single();

      const { error: enqueueError } = await adminClient.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          message_id: messageId,
          idempotency_key: messageId,
          to: recipient,
          from: FROM_DISPLAY,
          sender_domain: senderDomain,
          subject,
          text: emailText,
          html: emailHtml,
          purpose: "transactional",
          label: "order_confirmation",
          queued_at: new Date().toISOString(),
        },
      });

      if (enqueueError) {
        if (logRow?.id) {
          await adminClient
            .from("email_send_log")
            .update({ status: "failed", error_message: `Failed to enqueue: ${enqueueError.message}` })
            .eq("id", logRow.id);
        }
        return { ok: false, message_id: messageId, error: enqueueError.message };
      }
      return { ok: true, message_id: messageId };
    }

    const primary = await enqueueOne(account.billing_email);
    if (!primary.ok) {
      console.error("[confirm-order-email] Failed to enqueue primary:", primary.error);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to enqueue email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ccCopy = await enqueueOne(CC_ADDRESS);
    if (!ccCopy.ok) {
      console.warn("[confirm-order-email] Failed to enqueue CC copy (non-fatal):", ccCopy.error);
    }

    console.log(`[confirm-order-email] Enqueued confirmation for order ${orderNumber} → ${account.billing_email} (cc copy: ${CC_ADDRESS})`);

    return new Response(
      JSON.stringify({ ok: true, message_id: primary.message_id, cc_message_id: ccCopy.message_id }),
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
