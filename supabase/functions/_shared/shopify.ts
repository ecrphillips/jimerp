// Shared Shopify OAuth (authorization code grant) helpers for edge functions.
//
// Required Supabase secrets:
//   SHOPIFY_API_KEY       — app client_id (Shopify Partner dashboard)
//   SHOPIFY_API_SECRET    — app client secret (token exchange + HMAC verification)
//   SHOPIFY_TOKEN_ENC_KEY — base64 32-byte key for token encryption (see crypto.ts)
//
// The flow is hand-rolled with fetch + crypto.subtle, mirroring the QuickBooks
// helpers. Offline (non-expiring) access tokens are requested.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptSecret } from "./crypto.ts";

// Scopes our app requires. Offline token; do not request per-user (online).
export const SHOPIFY_REQUIRED_SCOPES = ["read_orders", "read_products", "read_customers"];
export const SHOPIFY_SCOPE = SHOPIFY_REQUIRED_SCOPES.join(",");

const SHOP_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function getShopifyCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = Deno.env.get("SHOPIFY_API_KEY");
  const apiSecret = Deno.env.get("SHOPIFY_API_SECRET");
  if (!apiKey || !apiSecret) {
    throw new Error("SHOPIFY_API_KEY / SHOPIFY_API_SECRET secrets are not set");
  }
  return { apiKey, apiSecret };
}

// The redirect URI registered in shopify.app.toml / the Partner dashboard. Must
// match byte-for-byte or Shopify rejects the callback with redirect_uri error.
export function getRedirectUri(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopify-oauth-callback`;
}

// Validates and normalizes a shop param to a bare `*.myshopify.com` host.
// Returns null if it doesn't match the strict myshopify.com format (rejects
// e.g. evil.myshopify.com.attacker.com, foo.com, .myshopify.com).
export function normalizeShop(input: string | null): string | null {
  if (!input) return null;
  const shop = input.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  return SHOP_RE.test(shop) ? shop : null;
}

export function isValidShop(shop: string): boolean {
  return SHOP_RE.test(shop);
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verifies the HMAC on a Shopify request query string. Remove hmac/signature,
// sort remaining params alphabetically, join decoded `key=value` pairs with `&`,
// HMAC-SHA256 with the app secret, hex, constant-time compare. Values are NOT
// re-encoded — URLSearchParams already yields decoded values, which is the form
// Shopify signs for query-string HMACs.
export async function verifyShopifyHmac(params: URLSearchParams): Promise<boolean> {
  const provided = params.get("hmac");
  if (!provided) return false;
  const { apiSecret } = getShopifyCredentials();

  const entries: [string, string][] = [];
  for (const [k, v] of params) {
    if (k === "hmac" || k === "signature") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");

  const computed = await hmacSha256Hex(message, apiSecret);
  return timingSafeEqual(computed, provided.toLowerCase());
}

// Exchanges the authorization code for a permanent offline access token.
// POST https://{shop}/admin/oauth/access_token. Never log the returned token.
export async function exchangeShopifyCode(
  shop: string,
  code: string,
): Promise<{ access_token: string; scope: string }> {
  const { apiKey, apiSecret } = getShopifyCredentials();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token exchange ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("token exchange returned no access_token");
  return { access_token: data.access_token as string, scope: (data.scope ?? "") as string };
}

// A merchant can alter the scope param mid-flow, so verify the granted scope
// actually contains every required scope before trusting/storing the token.
export function hasRequiredScopes(grantedScope: string): boolean {
  const granted = new Set(
    grantedScope.split(",").map((s) => s.trim()).filter(Boolean),
  );
  return SHOPIFY_REQUIRED_SCOPES.every((s) => granted.has(s));
}

// Persists the access token ENCRYPTED (AAD = bare shop host) into the existing
// shopify_sources.api_access_token column and clears the single-use state.
// Upserts so a freshly-installing merchant with no row yet still works.
export async function storeShopifyToken(
  supabase: SupabaseClient,
  shop: string,
  accessToken: string,
  scope: string,
): Promise<void> {
  const encrypted = await encryptSecret(accessToken, shop);
  const { error } = await supabase
    .from("shopify_sources")
    .update({
      api_access_token: encrypted,
      api_scopes: scope,
      token_expires_at: null, // offline tokens do not expire
      oauth_state: null, // single use
      oauth_state_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("store_url", `https://${shop}`);
  if (error) throw error;
}
