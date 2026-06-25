// Unit tests for the Shopify OAuth helpers.
// Run: deno test --allow-env supabase/functions/_shared/shopify.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Env must be set before importing the modules' functions read it (read lazily
// at call time, so setting here is sufficient).
const SECRET = "hush-test-secret";
Deno.env.set("SHOPIFY_API_KEY", "test-key");
Deno.env.set("SHOPIFY_API_SECRET", SECRET);
// base64 of 32 bytes (all 0x01) — fixed test key.
Deno.env.set(
  "SHOPIFY_TOKEN_ENC_KEY",
  btoa(String.fromCharCode(...new Array(32).fill(1))),
);

const {
  normalizeShop,
  isValidShop,
  hasRequiredScopes,
  verifyShopifyHmac,
} = await import("./shopify.ts");
const { encryptSecret, decryptSecret, looksEncrypted } = await import("./crypto.ts");

// Independent HMAC-SHA256 hex to sign test fixtures (mirrors Shopify's format).
async function signQuery(params: URLSearchParams, secret: string): Promise<string> {
  const entries: [string, string][] = [];
  for (const [k, v] of params) {
    if (k === "hmac" || k === "signature") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
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

Deno.test("shop regex: accepts valid, rejects spoofs", () => {
  assert(isValidShop("no-smoke-coffee.myshopify.com"));
  assertEquals(normalizeShop("https://Foo-Bar.myshopify.com/"), "foo-bar.myshopify.com");
  assertEquals(normalizeShop("foo.com"), null);
  assertEquals(normalizeShop("evil.myshopify.com.attacker.com"), null);
  assertEquals(normalizeShop(".myshopify.com"), null);
  assertEquals(normalizeShop(null), null);
});

Deno.test("hasRequiredScopes: all / missing / extras", () => {
  assert(hasRequiredScopes("read_orders,read_products,read_customers"));
  assert(hasRequiredScopes("read_orders, read_products, read_customers, write_products"));
  assert(!hasRequiredScopes("read_orders,read_products"));
  assert(!hasRequiredScopes(""));
});

Deno.test("verifyShopifyHmac: valid passes, tampered fails", async () => {
  const params = new URLSearchParams({
    code: "abc123",
    shop: "no-smoke-coffee.myshopify.com",
    state: "nonce-1",
    timestamp: "1700000000",
  });
  const good = await signQuery(params, SECRET);

  const ok = new URLSearchParams(params);
  ok.set("hmac", good);
  assert(await verifyShopifyHmac(ok));

  // Tampered value → different message → fails.
  const tampered = new URLSearchParams(params);
  tampered.set("shop", "evil.myshopify.com");
  tampered.set("hmac", good);
  assert(!(await verifyShopifyHmac(tampered)));

  // Wrong hmac → fails.
  const wrong = new URLSearchParams(params);
  wrong.set("hmac", "deadbeef");
  assert(!(await verifyShopifyHmac(wrong)));

  // Missing hmac → fails.
  assert(!(await verifyShopifyHmac(new URLSearchParams(params))));
});

Deno.test("crypto: AES round-trip, wrong AAD throws", async () => {
  const shop = "no-smoke-coffee.myshopify.com";
  const token = "shpat_supersecrettoken";
  const blob = await encryptSecret(token, shop);

  assert(looksEncrypted(blob));
  assert(!looksEncrypted(token)); // plaintext shpat_ detected
  assertEquals(await decryptSecret(blob, shop), token);

  // Wrong AAD (different shop) must fail to decrypt.
  await assertRejects(() => decryptSecret(blob, "other.myshopify.com"));
});
