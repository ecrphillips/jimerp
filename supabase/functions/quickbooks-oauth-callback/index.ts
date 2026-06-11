// quickbooks-oauth-callback — the Redirect URI registered in the Intuit
// Developer portal. Intuit redirects the admin's browser here with
// ?code=...&state=...&realmId=... after they authorize the sandbox company.
//
// verify_jwt = false (browser redirect carries no Supabase JWT). Security
// comes from the single-use, time-limited `state` value stored by
// quickbooks-oauth-start — requests with a missing/mismatched state are
// rejected before any token exchange.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceClient,
  getConnection,
  exchangeCodeForTokens,
  storeTokens,
} from "../_shared/quickbooks.ts";

function htmlPage(title: string, body: string, isError: boolean): Response {
  const color = isError ? "#b91c1c" : "#15803d";
  const siteUrl = Deno.env.get("SITE_URL") || "https://homeislandcoffeepartners.lovable.app";
  return new Response(
    `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; text-align: center;">
  <h1 style="color: ${color}; font-size: 1.4rem;">${title}</h1>
  <p style="color: #374151;">${body}</p>
  <p><a href="${siteUrl}/admin-tools" style="color: #2563eb;">Return to JIM Admin Tools</a></p>
</body>
</html>`,
    {
      status: isError ? 400 : 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const realmId = url.searchParams.get("realmId");
    const intuitError = url.searchParams.get("error");

    if (intuitError) {
      return htmlPage(
        "QuickBooks connection failed",
        `Intuit returned an error: ${intuitError}. No tokens were stored.`,
        true,
      );
    }
    if (!code || !state || !realmId) {
      return htmlPage(
        "QuickBooks connection failed",
        "Missing code, state, or realmId in the callback from Intuit.",
        true,
      );
    }

    const supabase = getServiceClient();
    const conn = await getConnection(supabase);

    const stateValid = conn?.oauth_state &&
      conn.oauth_state === state &&
      conn.oauth_state_expires_at &&
      new Date(conn.oauth_state_expires_at).getTime() > Date.now();

    if (!stateValid) {
      return htmlPage(
        "QuickBooks connection failed",
        "Invalid or expired state. Start the connection again from JIM Admin Tools.",
        true,
      );
    }

    const tokens = await exchangeCodeForTokens(code);
    await storeTokens(supabase, tokens, {
      realm_id: realmId,
      connected_at: new Date().toISOString(),
      oauth_state: null, // single use
      oauth_state_expires_at: null,
    });

    // Redirect straight back to Admin Tools — some deploy paths serve the
    // HTML body as plain text, so a 302 is the reliable success UX.
    const siteUrl = Deno.env.get("SITE_URL") || "https://homeislandcoffeepartners.lovable.app";
    return new Response(null, {
      status: 302,
      headers: { Location: `${siteUrl}/admin-tools` },
    });
  } catch (err) {
    console.error("quickbooks-oauth-callback error:", err);
    return htmlPage(
      "QuickBooks connection failed",
      "The token exchange with Intuit failed. Check the edge function logs and try again.",
      true,
    );
  }
});
