import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";
import { fanOutNotification, type NotificationEventType } from "../_shared/notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotifyBookingRequest {
  booking_id: string;
  event_type: "BOOKING_CREATED" | "BOOKING_CANCELLED";
}

const ALLOWED_EVENTS: NotificationEventType[] = ["BOOKING_CREATED", "BOOKING_CANCELLED"];

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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: NotifyBookingRequest = await req.json();
    if (!body.booking_id || !ALLOWED_EVENTS.includes(body.event_type)) {
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id and valid event_type required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch booking + account context
    const { data: booking, error: bookingError } = await adminClient
      .from("coroast_bookings")
      .select(`
        id,
        booking_date,
        start_time,
        end_time,
        account_id,
        status,
        account:accounts(account_name)
      `)
      .eq("id", body.booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Authorization: ADMIN/OPS, or active member of the booking's account
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const isInternal = roleData?.role === "ADMIN" || roleData?.role === "OPS";

    if (!isInternal) {
      let authorized = false;
      if (booking.account_id) {
        const { data: accountUser } = await adminClient
          .from("account_users")
          .select("id")
          .eq("account_id", booking.account_id)
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle();
        authorized = !!accountUser;
      }
      if (!authorized) {
        return new Response(
          JSON.stringify({ ok: false, error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // deno-lint-ignore no-explicit-any
    const accountName = (booking.account as any)?.account_name ?? "Unknown member";
    const action = body.event_type === "BOOKING_CREATED" ? "New" : "Cancelled";

    const fanOut = await fanOutNotification(adminClient, {
      eventType: body.event_type,
      label: body.event_type === "BOOKING_CREATED"
        ? "booking_created_notification"
        : "booking_cancelled_notification",
      buildEmail: () => ({
        subject: `${action} co-roast booking — ${accountName} — ${booking.booking_date}`,
        text:
          `${action} co-roast booking.\n\n` +
          `Member: ${accountName}\n` +
          `Date: ${booking.booking_date}\n` +
          `Time: ${booking.start_time} – ${booking.end_time}\n` +
          `Status: ${booking.status}\n` +
          `\nOpen in JIM: /internal/bookings\n`,
      }),
    });

    return new Response(
      JSON.stringify({
        ok: true,
        emails_enqueued: fanOut.enqueued,
        errors: fanOut.errors,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notify-booking-event] Unexpected error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
