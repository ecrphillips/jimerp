// shopify-oauth-callback — the Redirect URI registered in shopify.app.toml /
// the Partner dashboard. Shopify redirects the merchant's browser here with
// ?code=...&shop=...&state=...&hmac=...&timestamp=... after they approve.
//
// verify_jwt = false (browser redirect carries no Supabase JWT). Security:
//  1. HMAC over the query (request authenticity + integrity) — checked first.
//  2. Install identity resolved two ways:
//     a. NONCE PATH — our own shopify-oauth-start wrote a single-use, time-limited
//        `state` onto the source row; match on it (CSRF defense).
//     b. SHOPIFY-INITIATED PATH — install launched from Shopify's Partner-dashboard
//        custom install link. No nonce exists in our DB, so after a MANDATORY HMAC
//        pass we resolve the row by store_url = 'https://' + shop.
//  3. Granted scope verified to contain all required scopes before storing.
// The access token is stored ENCRYPTED and never logged.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceClient,
  verifyShopifyHmac,
  normalizeShop,
  isValidShop,
  exchangeShopifyCode,
  hasRequiredScopes,
  storeShopifyToken,
  shopHost,
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
  const supabase = getServiceClient();
  let shop: string | null = null;
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const shopifyError = url.searchParams.get("error");

    shop = normalizeShop(url.searchParams.get("shop"));
    await debug(supabase, shop, "callback_entered", `state=${state ? "present" : "absent"}`);

    if (shopifyError) {
      return htmlPage(
        "Shopify install failed",
        `Shopify returned an error: ${shopifyError}. No token was stored.`,
        true,
      );
    }

    // shop + code are required for both paths; state only for the nonce path.
    if (!shop || !code) {
      await debug(supabase, shop, "row_not_found", "missing shop or code in callback");
      return htmlPage(
        "Shopify install failed",
        "Missing or invalid shop or code in the callback from Shopify.",
        true,
      );
    }

    // HMAC first — before any DB lookup or token exchange. This is what proves the
    // request really came from Shopify and is signed with OUR app secret
    // (SHOPIFY_API_SECRET for the HOME ISLAND FUNK app). A failure here means a
    // wrong-secret / tampered-request problem, NOT a row-lookup problem.
    const hmacOk = await verifyShopifyHmac(url.searchParams);
    if (!hmacOk) {
      await debug(supabase, shop, "hmac_failed");
      return htmlPage("Shopify install failed", "HMAC verification failed.", true);
    }
    await debug(supabase, shop, "hmac_ok");

    // Resolve the install row. Try the nonce path first (our own start flow), then
    // fall back to the Shopify-initiated path (resolve by store_url).
    let source: { id: string; store_url: string } | null = null;

    if (state) {
      const { data, error: loadErr } = await supabase
        .from("shopify_sources")
        .select("id, store_url, oauth_state_expires_at")
        .eq("oauth_state", state)
        .maybeSingle();
      if (loadErr) throw loadErr;

      const stateValid = data &&
        data.oauth_state_expires_at &&
        new Date(data.oauth_state_expires_at).getTime() > Date.now();
      if (stateValid) {
        source = { id: data.id, store_url: data.store_url };
        await debug(supabase, shop, "nonce_path", `source_id=${source.id}`);
      }
    }

    if (!source) {
      // SHOPIFY-INITIATED PATH. No matching/valid nonce. HMAC already passed above
      // (mandatory), so the request is authentic. Resolve the row by canonical
      // store_url = 'https://' + shop (byte-for-byte, same form used everywhere).
      await debug(supabase, shop, "shopify_initiated_path");

      if (!isValidShop(shop)) {
        await debug(supabase, shop, "row_not_found", "shop failed myshopify.com format check");
        return htmlPage(
          "Shopify install failed",
          "The shop parameter is not a valid *.myshopify.com domain.",
          true,
        );
      }

      const storeUrl = `https://${shop}`;
      const { data, error: loadErr } = await supabase
        .from("shopify_sources")
        .select("id, store_url")
        .eq("store_url", storeUrl)
        .maybeSingle();
      if (loadErr) throw loadErr;

      if (data) {
        source = { id: data.id, store_url: data.store_url };
      }
    }

    if (!source) {
      await debug(supabase, shop, "row_not_found", "no shopify_sources row matched nonce or store_url");
      return htmlPage(
        "Shopify install failed",
        "No matching Shopify source was found for this store. Start the install again.",
        true,
      );
    }
    await debug(supabase, shop, "row_found", `source_id=${source.id}`);

    // Canonical host = the registered store's host. The pull pipeline and the
    // token-encryption AAD both key off store_url, so exchange + encrypt against
    // the SAME host to keep everything consistent (and decryptable at pull time).
    const host = shopHost(source.store_url);

    let access_token: string;
    let scope: string;
    try {
      ({ access_token, scope } = await exchangeShopifyCode(host, code));
    } catch (exErr) {
      await debug(supabase, shop, "exchange_failed", String(exErr).slice(0, 500));
      throw exErr;
    }
    await debug(supabase, shop, "token_exchanged", `scope=${scope}`);

    // A merchant can alter the requested scope mid-flow — verify the granted
    // scope actually covers everything we need before trusting the token.
    if (!hasRequiredScopes(scope)) {
      await debug(supabase, shop, "store_failed", `insufficient scope: ${scope}`);
      return htmlPage(
        "Shopify install failed",
        `The granted permissions are missing required scopes (need ${SHOPIFY_SCOPE}). ` +
          "Reinstall and approve all requested permissions. No token was stored.",
        true,
      );
    }

    try {
      await storeShopifyToken(supabase, source.id, host, access_token, scope);
    } catch (stErr) {
      await debug(supabase, shop, "store_failed", String(stErr).slice(0, 500));
      throw stErr;
    }
    await debug(supabase, shop, "token_stored", `source_id=${source.id}`);

    const siteUrl = Deno.env.get("SITE_URL") || "https://homeislandcoffeepartners.lovable.app";
    return new Response(null, {
      status: 302,
      headers: { Location: `${siteUrl}/admin-tools` },
    });
  } catch (err) {
    console.error("shopify-oauth-callback error:", err);
    await debug(supabase, shop, "exchange_failed", `unhandled: ${String(err).slice(0, 500)}`);
    return htmlPage(
      "Shopify install failed",
      "The token exchange with Shopify failed. Check shopify_oauth_debug and try again.",
      true,
    );
  }
});
