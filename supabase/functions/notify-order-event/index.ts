// Generic order lifecycle email notifier.
// Handles ORDER_CONFIRMED, ORDER_SHIPPED, ORDER_CANCELLED, ORDER_CLIENT_EDITED.
// (ORDER_SUBMITTED is handled by the dedicated notify-new-order function.)
//
// Recipients:
//   • Order placer (created_by_user_id) — email pulled from profiles
//   • Account owners (account_users where is_owner = true and is_active = true)
//   • Shared mailbox (app_settings.notification_routes.<EVENT>) — only for
//     events that represent client/landmark changes (SUBMITTED, CANCELLED,
//     CLIENT_EDITED). Admin/ops changes (CONFIRMED, SHIPPED) do NOT go to
//     the shared mailbox.
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
  details?: string; // optional human note ("Cancelled by client", etc.)
}

const SHARED_MAILBOX_EVENTS: OrderEventType[] = [
  "ORDER_CANCELLED",
  "ORDER_CLIENT_EDITED",
];

const FROM_DISPLAY = "Home Island Coffee Partners <noreply@notify.homeislandcoffee.com>";
const FROM_DOMAIN = "notify.homeislandcoffee.com";

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

function buildBody(
  event: OrderEventType,
  orderNumber: string,
  accountName: string,
  workDeadline: string | null,
  details: string | undefined,
  origin: string,
) {
  const lines: string[] = [];
  switch (event) {
    case "ORDER_CONFIRMED":
      lines.push(`Order ${orderNumber} for ${accountName} has been confirmed by the Home Island team.`);
      break;
    case "ORDER_SHIPPED":
      lines.push(`Order ${orderNumber} for ${accountName} has been shipped.`);
      break;
    case "ORDER_CANCELLED":
      lines.push(`Order ${orderNumber} for ${accountName} has been cancelled.`);
      break;
    case "ORDER_CLIENT_EDITED":
      lines.push(`Order ${orderNumber} for ${accountName} was updated by the client.`);
      break;
  }
  if (workDeadline) lines.push(`Work deadline: ${workDeadline}`);
  if (details) lines.push(`Notes: ${details}`);
  lines.push("");
  lines.push(`View order: ${origin}/internal/orders/`);
  return lines.join("\n");
}

// deno-lint-ignore no-explicit-any
async function enqueueEmail(adminClient: any, recipient: string, label: string, subject: string, text: string) {
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
      to: recipient,
      from: FROM_DISPLAY,
      sender_domain: FROM_DOMAIN,
      subject,
      text,
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

    // Auth
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

    // Fetch order
    const { data: order, error: orderErr } = await adminClient
      .from("orders")
      .select(`
        id, order_number, work_deadline, account_id, created_by_user_id,
        account:accounts(account_name)
      `)
      .eq("id", body.order_id)
      .maybeSingle();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ ok: false, error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // deno-lint-ignore no-explicit-any
    const accountName = (order.account as any)?.account_name ?? "Account";

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

    // Resolve emails + filter by per-user EMAIL pref (default ON for this fan-out)
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

    // Shared mailbox (only for landmark client events)
    if (SHARED_MAILBOX_EVENTS.includes(body.event_type)) {
      const { data: setting } = await adminClient
        .from("app_settings")
        .select("value_json")
        .eq("key", `notification_routes.${body.event_type}`)
        .maybeSingle();
      // deno-lint-ignore no-explicit-any
      const v = setting?.value_json as any;
      if (v?.enabled && v?.shared_email) recipients.add(String(v.shared_email).toLowerCase());
    }

    // Send
    const origin = req.headers.get("origin") ?? "https://homeislandcoffeepartners.lovable.app";
    const subject = buildSubject(body.event_type, order.order_number, accountName);
    const text = buildBody(
      body.event_type, order.order_number, accountName,
      order.work_deadline, body.details, origin,
    );
    const label = `order_${body.event_type.toLowerCase().replace(/^order_/, "")}_notification`;

    let enqueued = 0;
    const errors: string[] = [];
    for (const r of recipients) {
      const { ok, error } = await enqueueEmail(adminClient, r, label, subject, text);
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
