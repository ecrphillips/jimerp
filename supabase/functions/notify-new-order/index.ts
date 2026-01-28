import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotifyRequest {
  order_id: string;
  test?: boolean;
  force?: boolean;
}

interface NotificationSettings {
  enabled: boolean;
  emails: string[];
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let resendApiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    // Common copy/paste mistake: user pastes `Bearer re_...` from examples
    if (resendApiKey.toLowerCase().startsWith("bearer ")) {
      resendApiKey = resendApiKey.slice("bearer ".length).trim();
    }

    if (!resendApiKey) {
      console.error("[notify-new-order] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!resendApiKey.startsWith("re_")) {
      console.error("[notify-new-order] RESEND_API_KEY appears malformed (expected prefix re_)");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const resend = new Resend(resendApiKey);

    const { order_id, test = false, force = false }: NotifyRequest = await req.json();

    if (!order_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "order_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[notify-new-order] Processing order_id=${order_id}, test=${test}, force=${force}`);

    // Load notification settings
    const { data: settingsRow, error: settingsError } = await adminClient
      .from("app_settings")
      .select("value_json")
      .eq("key", "order_submit_notification")
      .maybeSingle();

    if (settingsError) {
      console.error("[notify-new-order] Failed to load settings:", settingsError.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to load notification settings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const settings: NotificationSettings = settingsRow?.value_json || { enabled: false, emails: [] };
    console.log("[notify-new-order] Settings:", settings);

    // Check if notifications are disabled
    if (!settings.enabled) {
      console.log("[notify-new-order] Notifications disabled, skipping");
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "notifications_disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if no emails configured
    if (!settings.emails || settings.emails.length === 0) {
      console.log("[notify-new-order] No emails configured, skipping");
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "no_emails_configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch order details
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select(`
        id,
        order_number,
        status,
        requested_ship_date,
        work_deadline,
        delivery_method,
        client_po,
        client_notes,
        notify_email_sent_at,
        client:clients(id, name),
        location:client_locations(name, location_code)
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

    // Check idempotency (unless test or force)
    if (!test && !force && order.notify_email_sent_at) {
      console.log("[notify-new-order] Email already sent at:", order.notify_email_sent_at);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "already_sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch line items
    const { data: lineItems, error: lineItemsError } = await adminClient
      .from("order_line_items")
      .select(`
        quantity_units,
        grind,
        product:products(product_name, sku, bag_size_g, packaging_variant)
      `)
      .eq("order_id", order_id);

    if (lineItemsError) {
      console.error("[notify-new-order] Failed to fetch line items:", lineItemsError.message);
    }

    // Build email content
    const clientName = (order.client as any)?.name || "Unknown Client";
    const locationInfo = order.location 
      ? `${(order.location as any).name} (${(order.location as any).location_code})`
      : null;

    const appUrl = req.headers.get("origin") || "https://id-preview--3db16675-5a7a-40ca-b657-6ccdc5ce15e4.lovable.app";
    const orderDetailUrl = `${appUrl}/orders/${order_id}`;

    // Format line items
    const lineItemsHtml = (lineItems || [])
      .map((li: any) => {
        const product = li.product;
        const sku = product?.sku || "No SKU";
        const name = product?.product_name || "Unknown Product";
        const variant = product?.packaging_variant?.replace(/_/g, " ") || "";
        const grind = li.grind ? ` (${li.grind.replace(/_/g, " ")})` : "";
        return `<li>${sku} — ${name} ${variant}${grind}: <strong>${li.quantity_units} units</strong></li>`;
      })
      .join("\n");

    const totalUnits = (lineItems || []).reduce((sum: number, li: any) => sum + li.quantity_units, 0);

    const emailSubject = `New order submitted — ${clientName} — ${order.order_number}`;
    
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New Order Notification</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 8px;">New Order Submitted</h1>
  <p style="color: #666; margin-top: 0;">A new order has been submitted and needs confirmation.</p>
  
  <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 4px 0; color: #666;">Client:</td>
        <td style="padding: 4px 0; font-weight: 600;">${clientName}</td>
      </tr>
      <tr>
        <td style="padding: 4px 0; color: #666;">Order Number:</td>
        <td style="padding: 4px 0; font-weight: 600;">${order.order_number}</td>
      </tr>
      ${locationInfo ? `
      <tr>
        <td style="padding: 4px 0; color: #666;">Location:</td>
        <td style="padding: 4px 0;">${locationInfo}</td>
      </tr>
      ` : ""}
      ${order.work_deadline ? `
      <tr>
        <td style="padding: 4px 0; color: #666;">Work Deadline:</td>
        <td style="padding: 4px 0;">${order.work_deadline}</td>
      </tr>
      ` : ""}
      ${order.requested_ship_date ? `
      <tr>
        <td style="padding: 4px 0; color: #666;">Requested Ship Date:</td>
        <td style="padding: 4px 0;">${order.requested_ship_date}</td>
      </tr>
      ` : ""}
      <tr>
        <td style="padding: 4px 0; color: #666;">Delivery Method:</td>
        <td style="padding: 4px 0;">${order.delivery_method}</td>
      </tr>
      ${order.client_po ? `
      <tr>
        <td style="padding: 4px 0; color: #666;">Client PO:</td>
        <td style="padding: 4px 0;">${order.client_po}</td>
      </tr>
      ` : ""}
    </table>
  </div>
  
  <h2 style="font-size: 18px; margin-top: 24px;">Line Items (${totalUnits} units total)</h2>
  <ul style="padding-left: 20px; line-height: 1.6;">
    ${lineItemsHtml || "<li>No line items</li>"}
  </ul>
  
  ${order.client_notes ? `
  <div style="margin-top: 20px; padding: 12px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px;">
    <strong style="color: #92400e;">Client Notes:</strong>
    <p style="margin: 4px 0 0 0; color: #78350f;">${order.client_notes}</p>
  </div>
  ` : ""}
  
  <div style="margin-top: 24px;">
    <a href="${orderDetailUrl}" 
       style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
      View Order in Jim
    </a>
  </div>
  
  ${test ? `
  <div style="margin-top: 24px; padding: 12px; background: #dbeafe; border-radius: 4px;">
    <strong style="color: #1e40af;">🧪 This is a test notification</strong>
  </div>
  ` : ""}
  
  <p style="color: #999; font-size: 12px; margin-top: 32px;">
    This is an automated notification from Jim ERP.
  </p>
</body>
</html>
    `.trim();

    // Send email to all configured recipients
    console.log("[notify-new-order] Sending email to:", settings.emails);
    
    try {
      const { data: emailResult, error: emailError } = await resend.emails.send({
        from: "Jim ERP <notifications@homeisland.ca>",
        to: settings.emails,
        subject: emailSubject,
        html: emailHtml,
      });

      if (emailError) {
        throw emailError;
      }

      console.log("[notify-new-order] Email sent successfully:", emailResult);

      // Update order with success
      if (!test) {
        await adminClient
          .from("orders")
          .update({
            notify_email_sent_at: new Date().toISOString(),
            notify_email_error: null,
          })
          .eq("id", order_id);
      }

      return new Response(
        JSON.stringify({ 
          ok: true, 
          email_sent: true,
          recipients: settings.emails.length,
          order_number: order.order_number
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (emailErr: any) {
      console.error("[notify-new-order] Email send failed:", emailErr);
      
      const errorMessage = emailErr?.message || String(emailErr);

      // Update order with error
      if (!test) {
        await adminClient
          .from("orders")
          .update({
            notify_email_error: errorMessage,
          })
          .eq("id", order_id);
      }

      return new Response(
        JSON.stringify({ ok: false, error: errorMessage }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (err: any) {
    console.error("[notify-new-order] Unexpected error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
