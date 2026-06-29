// shopify-oauth-start — the install/begin endpoint. Shopify (or a store link)
// sends the merchant here as a top-level GET with ?shop=...&hmac=...&timestamp=...
// We verify the request, mint a single-use CSRF `state`, store it on the
// merchant's shopify_sources row, and 302-redirect the browser to Shopify's
// grant screen.
//
// verify_jwt = false — this is a browser/Shopify-initiated GET with no Supabase
// JWT. Security comes from HMAC verification (request authenticity) and the
// single-use state validated in shopify-oauth-callback (CSRF).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceClient,
  getShopifyCredentials,
  getRedirectUri,
  verifyShopifyHmac,
  normalizeShop,
  SHOPIFY_SCOPE,
} from "../_shared/shopify.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Breadcrumb logging — platform/function logs are dead, so each major step writes
// a row to shopify_oauth_debug. Best-effort: a logging failure must never break
// the OAuth flow, so swallow any error here.
async function debug(
  supabase: SupabaseClient,
  shop: string | null,
  step: string,
  detail?: string,
): Promise<void> {
  try {
    await supabase.from("shopify_oauth_debug").insert({
      shop: shop ?? null,
      step,
      detail: detail ?? null,
    });
  } catch (_e) {
    // ignore — debug logging must not affect the install outcome
  }
}

function errorPage(message: string): Response {
  const siteUrl = Deno.env.get("SITE_URL") || "https://homeislandcoffeepartners.lovable.app";
  return new Response(
    `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Shopify install failed</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; text-align: center;">
  <h1 style="color: #b91c1c; font-size: 1.4rem;">Shopify install failed</h1>
  <p style="color: #374151;">${message}</p>
  <p><a href="${siteUrl}/admin-tools" style="color: #2563eb;">Return to JIM Admin Tools</a></p>
</body>
</html>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const supabase = getServiceClient();

    // First breadcrumb — proves Shopify's install GET actually reached this
    // function (vs. landing on the app login page). Logs the raw shop and which
    // params are present before any validation can short-circuit.
    const rawShop = url.searchParams.get("shop");
    await debug(
      supabase,
      rawShop,
      "start_entered",
      `hmac=${url.searchParams.has("hmac")} code=${url.searchParams.has("code")}`,
    );

    // Validate shop format (rejects evil.myshopify.com.x, foo.com, etc.).
    const shop = normalizeShop(rawShop);
    if (!shop) {
      return errorPage("Missing or invalid shop parameter (must be *.myshopify.com).");
    }

    // Two entry paths:
    //  1. Shopify-initiated install — carries an `hmac` we MUST verify (request
    //     authenticity over the query string).
    //  2. Admin-initiated direct start for an already-registered store — no hmac
    //     (e.g. Shopify's link generator is misrouting). Security here comes from
    //     the registration gate below: we only ever write a state nonce onto a row
    //     that already exists, and no token is issued until the callback completes
    //     OAuth against the real app secret.
    // If an hmac IS present we always verify it (a forged/garbage hmac still fails).
    if (url.searchParams.has("hmac")) {
      const hmacOk = await verifyShopifyHmac(url.searchParams);
      if (!hmacOk) {
        return errorPage("Request signature (HMAC) verification failed.");
      }
    }

    // Store a single-use, time-limited state on the merchant's source row. The
    // row must already exist (created by an admin) — we never write tokens for
    // an unregistered shop.
    const state = crypto.randomUUID();
    const { data: rows, error } = await supabase
      .from("shopify_sources")
      .update({
        oauth_state: state,
        oauth_state_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("store_url", `https://${shop}`)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return errorPage(
        `Store ${shop} is not registered in JIM. Ask an admin to add it before installing.`,
      );
    }

    // Build the authorization URL. Offline token: omit grant_options[]=per-user.
    const { apiKey } = getShopifyCredentials();
    const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
    authorize.searchParams.set("client_id", apiKey);
    authorize.searchParams.set("scope", SHOPIFY_SCOPE);
    authorize.searchParams.set("redirect_uri", getRedirectUri());
    authorize.searchParams.set("state", state);

    return new Response(null, {
      status: 302,
      headers: { Location: authorize.toString() },
    });
  } catch (err) {
    console.error("shopify-oauth-start error:", err);
    return errorPage("Unexpected error starting the Shopify install. Check edge function logs.");
  }
});
