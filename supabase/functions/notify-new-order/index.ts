import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";
import { ensureUnsubscribeToken, fanOutNotification, unsubscribeFooter } from "../_shared/notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotifyRequest {
  order_id: string;
  test?: boolean;
}

const SHARED_MAILBOX = "orders@homeislandcoffee.com";
const FROM_DISPLAY = "Home Island Manufacturing <noreply@homeislandcoffee.com>";
const FROM_DOMAIN = "homeislandcoffee.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d: string | null): string {
  if (!d) return "TBD";
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return d;
  }
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

// deno-lint-ignore no-explicit-any
async function enqueueShared(adminClient: any, subject: string, text: string, html: string) {
  let unsubscribeToken: string;
  try {
    unsubscribeToken = await ensureUnsubscribeToken(adminClient, SHARED_MAILBOX);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[notify-new-order] shared mailbox token failed:", msg);
    return { ok: false, error: `unsubscribe token: ${msg}` };
  }
  const footer = unsubscribeFooter(unsubscribeToken);
  const finalText = `${text}${footer.text}`;
  const finalHtml = html.replace(/<\/body>/i, `${footer.html}</body>`);

  const messageId = crypto.randomUUID();
  const { data: logRow } = await adminClient
    .from("email_send_log")
    .insert({
      message_id: messageId,
      template_name: "order_submitted_notification",
      recipient_email: SHARED_MAILBOX,
      status: "pending",
    })
    .select("id")
    .single();

  const { error } = await adminClient.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      idempotency_key: messageId,
      to: SHARED_MAILBOX,
      from: FROM_DISPLAY,
      sender_domain: FROM_DOMAIN,
      subject,
      text: finalText,
      html: finalHtml,
      purpose: "transactional",
      label: "order_submitted_notification",
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error("[notify-new-order] shared mailbox enqueue failed:", error.message);
    if (logRow?.id) {
      await adminClient
        .from("email_send_log")
        .update({ status: "failed", error_message: `Failed to enqueue: ${error.message}` })
        .eq("id", logRow.id);
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
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

    console.log(`[notify-new-order] order_id=${order_id} test=${test} user=${user.id} role=${roleData.role}`);

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select(`
        id,
        order_number,
        requested_ship_date,
        work_deadline,
        client_id,
        account_id,
        created_by_admin,
        created_by_user_id,
        client:clients(id, name),
        account:accounts(id, account_name)
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

    const isInternal = roleData.role === "ADMIN" || roleData.role === "OPS";

    if (roleData.role === "CLIENT") {
      const legacyMatch = roleData.client_id && order.client_id === roleData.client_id;
      let authorized = legacyMatch;

      if (!authorized && order.account_id) {
        const { data: accountUser } = await adminClient
          .from("account_users")
          .select("id")
          .eq("account_id", order.account_id)
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle();
        authorized = !!accountUser;
      }

      if (!authorized) {
        console.error("[notify-new-order] CLIENT user attempted to access foreign order:", {
          user_id: user.id,
          user_client_id: roleData.client_id,
          order_client_id: order.client_id,
          order_account_id: order.account_id,
        });
        return new Response(
          JSON.stringify({ ok: false, error: "Forbidden - you can only notify for your own orders" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // deno-lint-ignore no-explicit-any
    const clientData = order.client as any;
    // deno-lint-ignore no-explicit-any
    const accountData = order.account as any;
    const clientName =
      clientData?.name ||
      accountData?.account_name ||
      "Unknown Client";

    let submittedByName: string | null = null;
    if (order.created_by_user_id) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("name")
        .eq("user_id", order.created_by_user_id)
        .maybeSingle();
      submittedByName = profile?.name ?? null;
    }

    const { error: notifError } = await adminClient
      .from("order_notifications")
      .insert({
        order_id: order.id,
        client_name: clientName,
        order_number: order.order_number,
        work_deadline: order.work_deadline,
        submitted_by_name: submittedByName,
        submitted_by_admin: order.created_by_admin === true,
      });

    if (notifError) {
      console.error("[notify-new-order] Failed to insert notification:", notifError.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to create notification" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[notify-new-order] order_notifications row inserted by", isInternal ? "internal user" : "client user");

    // Line items
    const { data: liRows, error: liErr } = await adminClient
      .from("order_line_items")
      .select("quantity_units, product:products(product_name)")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });
    if (liErr) console.warn("[notify-new-order] Line items fetch error:", liErr.message);
    const lineItems: LineItem[] = (liRows ?? []).map((li: { quantity_units: number; product: unknown }) => ({
      // deno-lint-ignore no-explicit-any
      product_name: (li.product as any)?.product_name ?? "Unknown Product",
      quantity_units: li.quantity_units,
    }));

    // Shipment / delivery
    const { data: shipment } = await adminClient
      .from("order_shipments")
      .select("delivery_method, ship_to_name, ship_to_address_line1, ship_to_address_line2, ship_to_city, ship_to_region, ship_to_postal, ship_to_country")
      .eq("order_id", order.id)
      .order("shipment_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    const ship: ShipTo | null = shipment ?? null;

    const requestedShip = order.requested_ship_date ?? order.work_deadline ?? null;
    const submitterLine = submittedByName ? `Submitted by: ${submittedByName}` : null;
    const shipFmt = formatShipTo(ship);

    const itemsText = lineItems.length === 0
      ? "  (no line items)"
      : lineItems.map((li) => `  • ${li.product_name} — ${li.quantity_units} units`).join("\n");

    const text = [
      `A new order has been submitted.`,
      ``,
      `Order number: ${order.order_number}`,
      `Account: ${clientName}`,
      submitterLine,
      `Requested ship date: ${formatDate(requestedShip)}`,
      ``,
      `Items:`,
      itemsText,
      ``,
      `Delivery:`,
      shipFmt.text,
      ``,
      `If you need to make changes, contact us at orders@homeislandcoffee.com.`,
      ``,
      `Open order: /internal/orders/${order.id}`,
    ].filter((l) => l !== null).join("\n");

    const itemRowsHtml = lineItems.length === 0
      ? `<tr><td colspan="2" style="padding:6px 0;color:#666;">(no line items)</td></tr>`
      : lineItems
          .map(
            (li) =>
              `<tr><td style="padding:4px 12px 4px 0;">${escapeHtml(li.product_name)}</td>` +
              `<td style="padding:4px 0;text-align:right;">${li.quantity_units} units</td></tr>`,
          )
          .join("");

    const subject = `New order ${order.order_number} — ${clientName}`;
    const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#333;margin:0 0 16px 0;">${escapeHtml(subject)}</h2>
  <p style="margin:0 0 16px 0;">A new order has been submitted.</p>
  <table style="border-collapse:collapse;margin:0 0 16px 0;">
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Order number</td><td style="padding:2px 0;"><strong>${escapeHtml(order.order_number)}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Account</td><td style="padding:2px 0;">${escapeHtml(clientName)}</td></tr>
    ${submittedByName ? `<tr><td style="padding:2px 12px 2px 0;color:#666;">Submitted by</td><td style="padding:2px 0;">${escapeHtml(submittedByName)}</td></tr>` : ""}
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Requested ship date</td><td style="padding:2px 0;">${escapeHtml(formatDate(requestedShip))}</td></tr>
  </table>
  <h3 style="margin:16px 0 8px 0;font-size:14px;">Items</h3>
  <table style="border-collapse:collapse;width:100%;margin:0 0 16px 0;border-top:1px solid #eee;border-bottom:1px solid #eee;">${itemRowsHtml}</table>
  <h3 style="margin:16px 0 8px 0;font-size:14px;">Delivery</h3>
  <p style="margin:0 0 16px 0;">${shipFmt.html}</p>
  <p style="margin:16px 0 8px 0;color:#666;font-size:13px;">If you need to make changes, contact us at <a href="mailto:orders@homeislandcoffee.com">orders@homeislandcoffee.com</a>.</p>
  <p style="margin:0;font-size:13px;">Open order: /internal/orders/${escapeHtml(order.id)}</p>
</body></html>`;

    // ========== EMAIL FAN-OUT ==========
    console.log("[notify-new-order] Starting email fan-out for ORDER_SUBMITTED");
    let emailFanOut: Awaited<ReturnType<typeof fanOutNotification>> | null = null;
    try {
      emailFanOut = await fanOutNotification(adminClient, {
        eventType: "ORDER_SUBMITTED",
        label: "order_submitted_notification",
        buildEmail: () => ({ subject, text, html }),
      });
      console.log(
        `[notify-new-order] fan-out per_user=${emailFanOut.per_user_recipients.length} shared=${emailFanOut.shared_recipients.length} enqueued=${emailFanOut.enqueued} errors=${emailFanOut.errors.length}`,
      );
      if (emailFanOut.errors.length > 0) {
        console.warn("[notify-new-order] fan-out errors:", emailFanOut.errors);
      }
    } catch (fanErr) {
      console.error("[notify-new-order] fan-out threw:", fanErr);
    }

    // Guarantee the shared orders inbox receives the email even when
    // app_settings.notification_routes.ORDER_SUBMITTED is missing/disabled.
    const sharedAlreadySent =
      emailFanOut?.shared_recipients.some((r) => r.toLowerCase() === SHARED_MAILBOX) ||
      emailFanOut?.per_user_recipients.some((r) => r.toLowerCase() === SHARED_MAILBOX) ||
      false;

    let sharedEnqueued = 0;
    if (!sharedAlreadySent) {
      console.log(`[notify-new-order] Guaranteed shared mailbox enqueue → ${SHARED_MAILBOX}`);
      const { ok } = await enqueueShared(adminClient, subject, text, html);
      if (ok) sharedEnqueued = 1;
    } else {
      console.log(`[notify-new-order] Shared mailbox ${SHARED_MAILBOX} already covered by fan-out`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        notification_created: true,
        order_number: order.order_number,
        client_name: clientName,
        emails_enqueued: (emailFanOut?.enqueued ?? 0) + sharedEnqueued,
        per_user_recipients: emailFanOut?.per_user_recipients ?? [],
        shared_recipients: emailFanOut?.shared_recipients ?? [],
        shared_fallback_enqueued: sharedEnqueued > 0,
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
