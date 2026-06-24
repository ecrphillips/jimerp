// shopify-oauth-callback — the Redirect URI registered in shopify.app.toml /
// the Partner dashboard. Shopify redirects the merchant's browser here with
// ?code=...&shop=...&state=...&hmac=...&timestamp=... after they approve.
//
// verify_jwt = false (browser redirect carries no Supabase JWT). Security:
//  1. HMAC over the query (request authenticity + integrity) — checked first.
//  2. Single-use, time-limited `state` (CSRF) matched against the source row.
//  3. Granted scope verified to contain all required scopes before storing.
// The access token is stored ENCRYPTED and never logged.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceClient,
  verifyShopifyHmac,
  normalizeShop,
  exchangeShopifyCode,
  hasRequiredScopes,
  storeShopifyToken,
  SHOPIFY_SCOPE,
} from "../_shared/shopify.ts";

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
    { status: isError ? 400 : 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const shopifyError = url.searchParams.get("error");

    if (shopifyError) {
      return htmlPage(
        "Shopify install failed",
        `Shopify returned an error: ${shopifyError}. No token was stored.`,
        true,
      );
    }

    const shop = normalizeShop(url.searchParams.get("shop"));
    if (!shop || !code || !state) {
      return htmlPage(
        "Shopify install failed",
        "Missing or invalid shop, code, or state in the callback from Shopify.",
        true,
      );
    }

    // HMAC first — before any DB lookup or token exchange.
    const hmacOk = await verifyShopifyHmac(url.searchParams);
    if (!hmacOk) {
      return htmlPage("Shopify install failed", "Request signature (HMAC) verification failed.", true);
    }

    const supabase = getServiceClient();
    const { data: source, error: loadErr } = await supabase
      .from("shopify_sources")
      .select("id, oauth_state, oauth_state_expires_at")
      .eq("store_url", `https://${shop}`)
      .maybeSingle();
    if (loadErr) throw loadErr;

    const stateValid = source?.oauth_state &&
      source.oauth_state === state &&
      source.oauth_state_expires_at &&
      new Date(source.oauth_state_expires_at).getTime() > Date.now();
    if (!stateValid) {
      return htmlPage(
        "Shopify install failed",
        "Invalid or expired state. Start the install again.",
        true,
      );
    }

    const { access_token, scope } = await exchangeShopifyCode(shop, code);

    // A merchant can alter the requested scope mid-flow — verify the granted
    // scope actually covers everything we need before trusting the token.
    if (!hasRequiredScopes(scope)) {
      return htmlPage(
        "Shopify install failed",
        `The granted permissions are missing required scopes (need ${SHOPIFY_SCOPE}). ` +
          "Reinstall and approve all requested permissions. No token was stored.",
        true,
      );
    }

    await storeShopifyToken(supabase, shop, access_token, scope);

    const siteUrl = Deno.env.get("SITE_URL") || "https://homeislandcoffeepartners.lovable.app";
    return new Response(null, {
      status: 302,
      headers: { Location: `${siteUrl}/admin-tools` },
    });
  } catch (err) {
    console.error("shopify-oauth-callback error:", err);
    return htmlPage(
      "Shopify install failed",
      "The token exchange with Shopify failed. Check the edge function logs and try again.",
      true,
    );
  }
});
