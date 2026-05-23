// Public unsubscribe handler. Reached from the link in transactional emails.
// GET /functions/v1/unsubscribe?token=<uuid>
//
// - Resolves the token in public.email_unsubscribe_tokens.
// - Inserts the associated email into public.suppressed_emails (idempotent).
// - Marks the token row's used_at timestamp.
// - Returns a simple confirmation HTML page.
//
// No auth header is required — this URL has to work from a click in an email.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const HTML_HEAD = `<!doctype html>
<html><head><meta charset="utf-8"><title>Home Island Coffee Partners</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #222; background: #fafafa; margin: 0; padding: 40px 16px; }
  .card { max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 32px; }
  h1 { margin: 0 0 12px 0; font-size: 20px; }
  p { margin: 0 0 12px 0; line-height: 1.5; }
  .muted { color: #666; font-size: 13px; }
  .ok { color: #1a7f37; }
  .err { color: #b42318; }
</style></head><body><div class="card">`;
const HTML_FOOT = `</div></body></html>`;

function htmlResponse(status: number, body: string): Response {
  return new Response(HTML_HEAD + body + HTML_FOOT, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return htmlResponse(
      405,
      `<h1>Method not allowed</h1><p class="muted">Use the unsubscribe link from your email.</p>`,
    );
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return htmlResponse(
        400,
        `<h1 class="err">Missing token</h1><p class="muted">This link is incomplete. If you received this from a Home Island Coffee Partners email, please reply to that email asking to be unsubscribed.</p>`,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: tokenRow, error: lookupErr } = await adminClient
      .from("email_unsubscribe_tokens")
      .select("id, email, used_at")
      .eq("token", token)
      .maybeSingle();

    if (lookupErr) {
      console.error("[unsubscribe] token lookup failed:", lookupErr.message);
      return htmlResponse(
        500,
        `<h1 class="err">Something went wrong</h1><p class="muted">Please try again later or reply to the email you received.</p>`,
      );
    }

    if (!tokenRow) {
      return htmlResponse(
        404,
        `<h1 class="err">Link not recognized</h1><p class="muted">This unsubscribe link is invalid or has expired. If you keep receiving emails you don't want, reply to one of them and we'll remove you manually.</p>`,
      );
    }

    const email = tokenRow.email;

    const { error: suppressErr } = await adminClient
      .from("suppressed_emails")
      .insert({
        email,
        reason: "unsubscribe",
        metadata: { source: "email_link", token_id: tokenRow.id },
      });

    // 23505 = unique violation: already suppressed. Treat as success.
    if (suppressErr && suppressErr.code !== "23505") {
      console.error("[unsubscribe] suppression insert failed:", suppressErr.message);
      return htmlResponse(
        500,
        `<h1 class="err">Something went wrong</h1><p class="muted">We couldn't complete the unsubscribe. Please reply to the email you received and we'll remove you manually.</p>`,
      );
    }

    if (!tokenRow.used_at) {
      await adminClient
        .from("email_unsubscribe_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", tokenRow.id);
    }

    console.log(`[unsubscribe] suppressed email=${email} token_id=${tokenRow.id}`);

    return htmlResponse(
      200,
      `<h1 class="ok">You've been unsubscribed</h1>
       <p>You've been unsubscribed from Home Island Coffee Partners notifications. We won't send any further transactional emails to <strong>${email}</strong>.</p>
       <p class="muted">If this was a mistake, reply to any prior email from us and we'll re-enable your notifications.</p>`,
    );
  } catch (err) {
    console.error("[unsubscribe] unhandled error:", err);
    return htmlResponse(
      500,
      `<h1 class="err">Something went wrong</h1><p class="muted">Please try again later.</p>`,
    );
  }
});
