// Generic order lifecycle email notifier.
// Handles ORDER_CONFIRMED, ORDER_SHIPPED, ORDER_CANCELLED, ORDER_CLIENT_EDITED.
// (ORDER_SUBMITTED is handled by the dedicated notify-new-order function.)
//
// Recipients:
//   • Order placer (created_by_user_id) — email pulled from profiles
//   • Account owners (account_users where is_owner = true and is_active = true)
//   • Shared mailbox (orders@homeislandcoffee.com) — for SHARED_MAILBOX_EVENTS
//
// Per-user EMAIL preferences are respected. If the user has an explicit
// pref row for (event_type, channel='EMAIL') with enabled=false, they are
// skipped. Otherwise (default), placer + owners receive the email.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type OrderEventType =
  | "ORDER_CONFIRMED"
  | "ORDER_SHIPPED"
  | "ORDER_CANCELLED"
  | "ORDER_CLIENT_EDITED";

interface NotifyBody {
  order_id: string;
  event_type: OrderEventType;
  details?: string;
}

const SHARED_MAILBOX_EVENTS: OrderEventType[] = [
  "ORDER_CONFIRMED",
  "ORDER_SHIPPED",
  "ORDER_CANCELLED",
  "ORDER_CLIENT_EDITED",
];

const FALLBACK_SHARED_MAILBOX = "orders@homeislandcoffee.com";

const FROM_DISPLAY = "Home Island Coffee Partners <noreply@notify.homeislandcoffee.com>";
const FROM_DOMAIN = "notify.homeislandcoffee.com";

interface LineItem {
  product_name: string;
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

function formatDate(d: string | null): string {
  if (!d) return "TBD";
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return d;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSubject(event: OrderEventType, orderNumber: string, accountName: string) {
  switch (event) {
    case "ORDER_CONFIRMED":
      return `Order ${orderNumber} confirmed — ${accountName}`;
    case "ORDER_SHIPPED":
      return `Order ${orderNumber} shipped — ${accountName}`;
    case "ORDER_CANCELLED":
      return `Order ${orderNumber} cancelled — ${accountName}`;
    case "ORDER_CLIENT_EDITED":
      return `Order ${orderNumber} updated by client — ${accountName}`;
  }
}

function eventHeadline(event: OrderEventType, orderNumber: string, accountName: string): string {
  switch (event) {
    case "ORDER_CONFIRMED":
      return `Order ${orderNumber} for ${accountName} has been confirmed by the Home Island team.`;
    case "ORDER_SHIPPED":
      return `Order ${orderNumber} for ${accountName} has shipped.`;
    case "ORDER_CANCELLED":
      return `Order ${orderNumber} for ${accountName} has been cancelled.`;
    case "ORDER_CLIENT_EDITED":
      return `Order ${orderNumber} for ${accountName} was updated by the client.`;
  }
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

function buildText(
  event: OrderEventType,
  orderNumber: string,
  accountName: string,
  requestedShipDate: string | null,
  lineItems: LineItem[],
  ship: ShipTo | null,
  details: string | undefined,
  origin: string,
): string {
  const lines: string[] = [];
  lines.push(eventHeadline(event, orderNumber, accountName));
  lines.push("");
  lines.push(`Order number: ${orderNumber}`);
  lines.push(`Account: ${accountName}`);
  lines.push(`Requested ship date: ${formatDate(requestedShipDate)}`);
  lines.push("");
  lines.push("Items:");
  if (lineItems.length === 0) lines.push("  (no line items)");
  else for (const li of lineItems) lines.push(`  • ${li.product_name} — ${li.quantity_units} units`);
  lines.push("");
  const shipFmt = formatShipTo(ship);
  lines.push("Delivery:");
  lines.push(shipFmt.text);
  if (details) {
    lines.push("");
    lines.push(`Notes: ${details}`);
  }
  lines.push("");
  lines.push("If you need to make changes, contact us at orders@homeislandcoffee.com.");
  lines.push("");
  lines.push(`View order: ${origin}/internal/orders/`);
  return lines.join("\n");
}

function buildHtml(
  event: OrderEventType,
  orderNumber: string,
  accountName: string,
  requestedShipDate: string | null,
  lineItems: LineItem[],
  ship: ShipTo | null,
  details: string | undefined,
  origin: string,
): string {
  const shipFmt = formatShipTo(ship);
  const itemRows = lineItems.length === 0
    ? `<tr><td colspan="2" style="padding:6px 0;color:#666;">(no line items)</td></tr>`
    : lineItems
        .map(
          (li) =>
            `<tr><td style="padding:4px 12px 4px 0;">${escapeHtml(li.product_name)}</td>` +
            `<td style="padding:4px 0;text-align:right;">${li.quantity_units} units</td></tr>`,
        )
        .join("");

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#333;margin:0 0 16px 0;">${escapeHtml(buildSubject(event, orderNumber, accountName))}</h2>
  <p style="margin:0 0 16px 0;">${escapeHtml(eventHeadline(event, orderNumber, accountName))}</p>

  <table style="border-collapse:collapse;margin:0 0 16px 0;">
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Order number</td><td style="padding:2px 0;"><strong>${escapeHtml(orderNumber)}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Account</td><td style="padding:2px 0;">${escapeHtml(accountName)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">Requested ship date</td><td style="padding:2px 0;">${escapeHtml(formatDate(requestedShipDate))}</td></tr>
  </table>

  <h3 style="margin:16px 0 8px 0;font-size:14px;">Items</h3>
  <table style="border-collapse:collapse;width:100%;margin:0 0 16px 0;border-top:1px solid #eee;border-bottom:1px solid #eee;">
    ${itemRows}
  </table>

  <h3 style="margin:16px 0 8px 0;font-size:14px;">Delivery</h3>
  <p style="margin:0 0 16px 0;">${shipFmt.html}</p>

  ${details ? `<p style="margin:0 0 16px 0;"><strong>Notes:</strong> ${escapeHtml(details)}</p>` : ""}

  <p style="margin:16px 0 8px 0;color:#666;font-size:13px;">If you need to make changes, contact us at <a href="mailto:orders@homeislandcoffee.com">orders@homeislandcoffee.com</a>.</p>
  <p style="margin:0;font-size:13px;"><a href="${escapeHtml(origin)}/internal/orders/">View order</a></p>
</body></html>`;
}

// deno-lint-ignore no-explicit-any
async function enqueueEmail(adminClient: any, recipient: string, label: string, subject: string, text: string, html: string) {
  const messageId = crypto.randomUUID();
  const { data: logRow } = await adminClient
    .from("email_send_log")
    .insert({
      message_id: messageId,
      template_name: label,
      recipient_email: recipient,
      status: "pending",
    })
    .select("id")
    .single();

  const { error } = await adminClient.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      idempotency_key: messageId,
      to: recipient,
      from: FROM_DISPLAY,
      sender_domain: FROM_DOMAIN,
      subject,
      text,
      html,
      purpose: "transactional",
      label,
      queued_at: new Date().toISOString(),
    },
  });

  if (error && logRow?.id) {
    await adminClient
      .from("email_send_log")
      .update({ status: "failed", error_message: `Failed to enqueue: ${error.message}` })
      .eq("id", logRow.id);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await adminClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as NotifyBody;
    if (!body?.order_id || !body?.event_type) {
      return new Response(JSON.stringify({ ok: false, error: "order_id and event_type required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[notify-order-event] order_id=${body.order_id} event=${body.event_type}`);

    const { data: order, error: orderErr } = await adminClient
      .from("orders")
      .select(`
        id, order_number, requested_ship_date, work_deadline, account_id, created_by_user_id,
        account:accounts(account_name)
      `)
      .eq("id", body.order_id)
      .maybeSingle();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ ok: false, error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: ADMIN/OPS, or active member of the order's account
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const isInternal = roleData?.role === "ADMIN" || roleData?.role === "OPS";
    if (!isInternal) {
      let authorized = false;
      if (order.account_id) {
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
        return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // deno-lint-ignore no-explicit-any
    const accountName = (order.account as any)?.account_name ?? "Account";

    // Line items
    const { data: liRows } = await adminClient
      .from("order_line_items")
      .select("quantity_units, product:products(product_name)")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });
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

    // Recipients: placer + active owners
    const userIds = new Set<string>();
    if (order.created_by_user_id) userIds.add(order.created_by_user_id);
    if (order.account_id) {
      const { data: owners } = await adminClient
        .from("account_users")
        .select("user_id")
        .eq("account_id", order.account_id)
        .eq("is_owner", true)
        .eq("is_active", true);
      for (const o of owners ?? []) if (o.user_id) userIds.add(o.user_id);
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
          .eq("event_type", body.event_type)
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
        recipients.add(p.email.toLowerCase());
      }
    }

    // Shared mailbox: app_settings override, else hardcoded fallback for SHARED_MAILBOX_EVENTS.
    if (SHARED_MAILBOX_EVENTS.includes(body.event_type)) {
      let sharedAdded: string | null = null;
      const { data: setting } = await adminClient
        .from("app_settings")
        .select("value_json")
        .eq("key", `notification_routes.${body.event_type}`)
        .maybeSingle();
      // deno-lint-ignore no-explicit-any
      const v = setting?.value_json as any;
      if (v?.enabled && v?.shared_email) {
        sharedAdded = String(v.shared_email).toLowerCase();
        recipients.add(sharedAdded);
      } else {
        sharedAdded = FALLBACK_SHARED_MAILBOX;
        recipients.add(FALLBACK_SHARED_MAILBOX);
      }
      console.log(`[notify-order-event] shared mailbox: ${sharedAdded}`);
    }

    const origin = req.headers.get("origin") ?? "https://homeislandcoffeepartners.lovable.app";
    const subject = buildSubject(body.event_type, order.order_number, accountName);
    const requestedShip = order.requested_ship_date ?? order.work_deadline ?? null;
    const text = buildText(body.event_type, order.order_number, accountName, requestedShip, lineItems, ship, body.details, origin);
    const html = buildHtml(body.event_type, order.order_number, accountName, requestedShip, lineItems, ship, body.details, origin);
    const label = `order_${body.event_type.toLowerCase().replace(/^order_/, "")}_notification`;

    console.log(`[notify-order-event] recipients=${[...recipients].join(",")}`);

    let enqueued = 0;
    const errors: string[] = [];
    for (const r of recipients) {
      const { ok, error } = await enqueueEmail(adminClient, r, label, subject, text, html);
      if (ok) enqueued++; else if (error) errors.push(`${r}: ${error}`);
    }

    return new Response(
      JSON.stringify({ ok: true, enqueued, recipients: [...recipients], errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notify-order-event] Unexpected:", err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
