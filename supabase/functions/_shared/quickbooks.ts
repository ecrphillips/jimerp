// Shared QuickBooks Online (SANDBOX ONLY) OAuth helpers for edge functions.
//
// Required Supabase secrets:
//   INTUIT_CLIENT_ID      — from the Intuit Developer portal (sandbox keys)
//   INTUIT_CLIENT_SECRET  — from the Intuit Developer portal (sandbox keys)
//
// The OAuth authorize/token endpoints are shared between Intuit environments;
// sandbox-ness comes from using sandbox app keys and the sandbox API base URL.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
export const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const INTUIT_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
// SANDBOX base URL only — do not point this at quickbooks.api.intuit.com.
export const QBO_API_BASE = "https://sandbox-quickbooks.api.intuit.com";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

export interface QboConnection {
  id: number;
  status: "disconnected" | "connected" | "needs_reconnect";
  access_token: string | null;
  refresh_token: string | null;
  realm_id: string | null;
  company_name: string | null;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  connected_at: string | null;
  oauth_state: string | null;
  oauth_state_expires_at: string | null;
}

export function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function getRedirectUri(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/quickbooks-oauth-callback`;
}

export function getIntuitCredentials(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get("INTUIT_CLIENT_ID");
  const clientSecret = Deno.env.get("INTUIT_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("INTUIT_CLIENT_ID / INTUIT_CLIENT_SECRET secrets are not set");
  }
  return { clientId, clientSecret };
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getIntuitCredentials();
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

/**
 * Verifies the caller's JWT and requires the ADMIN role.
 * Returns the user id, or a ready-to-send error Response.
 */
export async function requireAdmin(
  req: Request,
  supabase: SupabaseClient,
  corsHeaders: Record<string, string>,
): Promise<{ userId: string } | { response: Response }> {
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      }),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return {
      response: new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: jsonHeaders,
      }),
    };
  }

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleData?.role !== "ADMIN") {
    return {
      response: new Response(JSON.stringify({ error: "Forbidden: ADMIN only" }), {
        status: 403,
        headers: jsonHeaders,
      }),
    };
  }

  return { userId: user.id };
}

export async function getConnection(supabase: SupabaseClient): Promise<QboConnection | null> {
  const { data, error } = await supabase
    .from("quickbooks_connection")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data as QboConnection | null;
}

interface IntuitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (~3600)
  x_refresh_token_expires_in: number; // seconds (~100 days)
  token_type: string;
}

async function callTokenEndpoint(body: URLSearchParams): Promise<IntuitTokenResponse> {
  const res = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intuit token endpoint ${res.status}: ${text}`);
  }
  return await res.json();
}

export function exchangeCodeForTokens(code: string): Promise<IntuitTokenResponse> {
  return callTokenEndpoint(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
  }));
}

export function refreshAccessToken(refreshToken: string): Promise<IntuitTokenResponse> {
  return callTokenEndpoint(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export async function storeTokens(
  supabase: SupabaseClient,
  tokens: IntuitTokenResponse,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const now = Date.now();
  const { error } = await supabase
    .from("quickbooks_connection")
    .update({
      status: "connected",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // Intuit rotates refresh tokens — always store the new one
      token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
      ...extra,
    })
    .eq("id", 1);
  if (error) throw error;
}

export async function markNeedsReconnect(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase
    .from("quickbooks_connection")
    .update({
      status: "needs_reconnect",
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      refresh_token_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw error;
}

export type FreshTokenResult =
  | { ok: true; accessToken: string; realmId: string; tokenExpiresAt: string }
  | { ok: false; reason: "disconnected" | "needs_reconnect" };

/**
 * Returns a valid access token, refreshing it first if it expires within the
 * next 3 minutes. If the refresh token itself has expired (or Intuit rejects
 * it), flips the connection to needs_reconnect and reports that back.
 *
 * Call this from any edge function before making a QBO API call.
 */
export async function ensureFreshToken(supabase: SupabaseClient): Promise<FreshTokenResult> {
  const conn = await getConnection(supabase);
  if (!conn || conn.status === "disconnected" || !conn.refresh_token || !conn.realm_id) {
    return { ok: false, reason: "disconnected" };
  }
  if (conn.status === "needs_reconnect") {
    return { ok: false, reason: "needs_reconnect" };
  }

  const skewMs = 3 * 60 * 1000;
  const accessValid = conn.access_token &&
    conn.token_expires_at &&
    new Date(conn.token_expires_at).getTime() - skewMs > Date.now();

  if (accessValid) {
    return {
      ok: true,
      accessToken: conn.access_token!,
      realmId: conn.realm_id,
      tokenExpiresAt: conn.token_expires_at!,
    };
  }

  // Refresh token already past its expiry — no point calling Intuit.
  if (conn.refresh_token_expires_at && new Date(conn.refresh_token_expires_at).getTime() <= Date.now()) {
    await markNeedsReconnect(supabase);
    return { ok: false, reason: "needs_reconnect" };
  }

  try {
    const tokens = await refreshAccessToken(conn.refresh_token);
    await storeTokens(supabase, tokens);
    return {
      ok: true,
      accessToken: tokens.access_token,
      realmId: conn.realm_id,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };
  } catch (err) {
    console.error("QuickBooks token refresh failed:", err);
    await markNeedsReconnect(supabase);
    return { ok: false, reason: "needs_reconnect" };
  }
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const res = await fetch(INTUIT_REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: refreshToken }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intuit revoke endpoint ${res.status}: ${text}`);
  }
}
