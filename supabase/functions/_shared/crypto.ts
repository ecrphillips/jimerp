// AES-256-GCM encryption for secrets at rest (Shopify offline access tokens).
//
// Key comes from SHOPIFY_TOKEN_ENC_KEY: a base64-encoded 32-byte key
// (generate with `openssl rand -base64 32`). LOSING THIS KEY MAKES STORED
// TOKENS UNRECOVERABLE — back it up.
//
// Wire format (safe for a text column): base64( iv(12 bytes) || ciphertext||tag ).
// The AAD binds the ciphertext to the shop domain, so a token blob cannot be
// transplanted from one source row to another and still decrypt.

const ENC_KEY_ENV = "SHOPIFY_TOKEN_ENC_KEY";

function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function b64encode(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get(ENC_KEY_ENV);
  if (!raw) throw new Error(`${ENC_KEY_ENV} is not set`);
  const keyBytes = b64decode(raw.trim());
  if (keyBytes.length !== 32) {
    throw new Error(`${ENC_KEY_ENV} must decode to 32 bytes (got ${keyBytes.length})`);
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, aad: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
      key,
      enc.encode(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptSecret(blob: string, aad: string): Promise<string> {
  const key = await getKey();
  const raw = b64decode(blob);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    ct,
  );
  return new TextDecoder().decode(pt);
}

// Distinguishes an encrypted blob from a legacy plaintext Shopify token, so
// shopify-pull-orders can decrypt new tokens while still accepting old ones
// without a backfill. Shopify tokens are prefixed shpat_ (custom app) / shpca_
// (client-credentials) — our base64 ciphertext never carries those prefixes.
export function looksEncrypted(value: string): boolean {
  return !value.startsWith("shpat_") && !value.startsWith("shpca_");
}
