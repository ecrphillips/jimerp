// Shared CORS helpers for edge functions.
// Allowed origins come from CORS_ALLOWED_ORIGINS (comma-separated) with a
// sensible fallback to SITE_URL plus local dev. Set CORS_ALLOWED_ORIGINS in
// the Supabase project to override.

const DEFAULT_DEV_ORIGIN = 'http://localhost:8080';

// Lovable-hosted preview/published origins. Any subdomain of these hosts is allowed.
const ALLOWED_HOST_SUFFIXES = ['.lovableproject.com', '.lovable.app', '.lovable.dev'];

function loadAllowedOrigins(): string[] {
  const raw = Deno.env.get('CORS_ALLOWED_ORIGINS');
  if (raw && raw.trim().length > 0) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const siteUrl = Deno.env.get('SITE_URL') || 'https://homeislandcoffeepartners.lovable.app';
  return [siteUrl, DEFAULT_DEV_ORIGIN];
}

function originMatches(origin: string, allowed: string[]): boolean {
  if (allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

export function corsHeadersFor(req: Request): Record<string, string> {
  const allowed = loadAllowedOrigins();
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = originMatches(origin, allowed) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return originMatches(origin, loadAllowedOrigins());
}
