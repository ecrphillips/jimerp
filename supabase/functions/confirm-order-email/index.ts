// Sends the customer-facing ORDER_CONFIRMED email.
//
// Recipients are resolved the same way as notify-order-event for
// ORDER_CONFIRMED:
//   • Order placer (orders.created_by_user_id)
//   • Active owners on the order's account (account_users.is_owner=true AND is_active=true)
// All recipients are filtered through user_notification_preferences for
// (event_type=ORDER_CONFIRMED, channel=EMAIL). A user with enabled=false is
// skipped; everyone else (default) receives the email.
//
// Notably we do NOT fall back to accounts.billing_email or any other
// account-level address. Shared mailbox CCs are also gone — orders@homeislandcoffee.com
// is reserved for ORDER_SUBMITTED.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";
import {
  ensureUnsubscribeToken,
  renderOrderItemsHtml,
  renderOrderItemsText,
  unsubscribeFooter,
} from "../_shared/notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FROM_ADDRESS = "noreply@homeislandcoffee.com";
const FROM_DISPLAY = "Home Island Manufacturing <noreply@homeislandcoffee.com>";

interface ConfirmRequest {
  order_id: string;
}

interface LineItem {
  product_name: string;
  bag_size_g: number | null;
  quantity_units: number;
}

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

    const { data: roleData, error: roleError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || !roleData || !["ADMIN", "OPS"].includes(roleData.role)) {
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
      .select("id, order_number, requested_ship_date, work_deadline, work_deadline_at, account_id, created_by_user_id, status")
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
      .select("account_name")
      .eq("id", order.account_id)
      .maybeSingle();

    if (accountError || !account) {
      console.error("[confirm-order-email] Account not found for order:", order_id);
      return new Response(
        JSON.stringify({ ok: false, error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: liRows, error: lineError } = await adminClient
      .from("order_line_items")
      .select("quantity_units, product:products(product_name, bag_size_g)")
      .eq("order_id", order_id)
      .order("created_at", { ascending: true });

    if (lineError) {
      console.error("[confirm-order-email] Failed to fetch line items:", lineError.message);
    }
    const lineItems: LineItem[] = (liRows ?? []).map((li: { quantity_units: number; product: unknown }) => ({
      // deno-lint-ignore no-explicit-any
      product_name: (li.product as any)?.product_name ?? "Unknown Product",
      // deno-lint-ignore no-explicit-any
      bag_size_g: (li.product as any)?.bag_size_g ?? null,
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

    // ---- Resolve recipients: placer + active owners, filtered by per-user EMAIL prefs ----
    const userIds = new Set<string>();
    if (order.created_by_user_id) userIds.add(order.created_by_user_id);
    if (order.account_id) {
      const { data: owners } = await adminClient
        .from("account_users")
        .select("user_id")
        .eq("account_id", order.account_id)
        .eq("is_owner", true)
        .eq("is_active", true);
      // deno-lint-ignore no-explicit-any
      for (const o of (owners ?? []) as any[]) {
        if (o?.user_id) userIds.add(o.user_id);
      }
    }

    const recipients = new Set<string>();
    if (userIds.size > 0) {
      const ids = [...userIds];
      const [{ data: profiles }, { data: prefs }] = await Promise.all([
        adminClient.from("profiles").select("user_id, email").in("user_id", ids),
        adminClient
          .from("user_notification_preferences")
          .select("user_id, enabled")
          .in("user_id", ids)
          .eq("event_type", "ORDER_CONFIRMED")
          .eq("channel", "EMAIL"),
      ]);
      const disabled = new Set(
        // deno-lint-ignore no-explicit-any
        (prefs ?? []).filter((p: any) => p.enabled === false).map((p: any) => p.user_id),
      );
      // deno-lint-ignore no-explicit-any
      for (const p of (profiles ?? []) as any[]) {
        if (!p?.email) continue;
        if (disabled.has(p.user_id)) continue;
        recipients.add(String(p.email).toLowerCase());
      }
    }

    if (recipients.size === 0) {
      console.warn(`[confirm-order-email] No eligible recipients for order ${order_id} — nothing to send`);
      return new Response(
        JSON.stringify({ ok: true, enqueued: 0, recipients: [], message: "No eligible recipients" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountName = account.account_name;
    const orderNumber = order.order_number;
    const roastDay = formatDate(order.work_deadline_at ?? order.work_deadline ?? null);
    const shipDate = formatDate(order.requested_ship_date);
    const shipFmt = formatShipTo(ship);

    const itemsText = renderOrderItemsText(lineItems);
    const itemRowsHtml = renderOrderItemsHtml(lineItems);

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

    const senderDomain = FROM_ADDRESS.split("@")[1];

    async function enqueueOne(recipient: string): Promise<{ ok: boolean; message_id: string; error?: string }> {
      let unsubscribeToken: string;
      try {
        unsubscribeToken = await ensureUnsubscribeToken(adminClient, recipient);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, message_id: "", error: `unsubscribe token: ${msg}` };
      }
      const footer = unsubscribeFooter(unsubscribeToken);
      const finalText = `${emailText}${footer.text}`;
      const finalHtml = emailHtml.replace(/<\/body>/i, `${footer.html}</body>`);

      const messageId = crypto.randomUUID();
      const { data: logRow, error: logError } = await adminClient
        .from("email_send_log")
        .insert({
          message_id: messageId,
          template_name: "order_confirmation",
          recipient_email: recipient,
          status: "pending",
        })
        .select("id")
        .maybeSingle();
      if (logError) {
        console.error("[confirm-order-email] email_send_log insert failed:", logError.message);
      }

      const { error: enqueueError } = await adminClient.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          message_id: messageId,
          idempotency_key: messageId,
          to: recipient,
          from: FROM_DISPLAY,
          sender_domain: senderDomain,
          subject,
          text: finalText,
          html: finalHtml,
          purpose: "transactional",
          label: "order_confirmation",
          unsubscribe_token: unsubscribeToken,
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

    const results: { recipient: string; ok: boolean; message_id: string; error?: string }[] = [];
    for (const r of recipients) {
      const result = await enqueueOne(r);
      results.push({ recipient: r, ...result });
    }

    const enqueued = results.filter((r) => r.ok).length;
    const errors = results.filter((r) => !r.ok).map((r) => `${r.recipient}: ${r.error}`);

    console.log(
      `[confirm-order-email] order ${orderNumber} → enqueued=${enqueued}/${recipients.size} recipients=[${[...recipients].join(",")}]`,
    );
    if (errors.length > 0) {
      console.warn(`[confirm-order-email] errors:`, errors);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        enqueued,
        recipients: [...recipients],
        errors,
      }),
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
