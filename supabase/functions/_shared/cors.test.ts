import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { corsHeadersFor, isOriginAllowed } from './cors.ts';

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = Deno.env.get(k);
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test('corsHeadersFor echoes allowed origin', () => {
  withEnv({ CORS_ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:8080' }, () => {
    const req = new Request('https://fn.example.com/', {
      headers: { Origin: 'https://app.example.com' },
    });
    const h = corsHeadersFor(req);
    assertEquals(h['Access-Control-Allow-Origin'], 'https://app.example.com');
    assertEquals(h['Vary'], 'Origin');
  });
});

Deno.test('corsHeadersFor falls back to first allowed origin when request origin not allowed', () => {
  withEnv({ CORS_ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:8080' }, () => {
    const req = new Request('https://fn.example.com/', {
      headers: { Origin: 'https://evil.example.com' },
    });
    const h = corsHeadersFor(req);
    assertEquals(h['Access-Control-Allow-Origin'], 'https://app.example.com');
  });
});

Deno.test('corsHeadersFor never returns wildcard', () => {
  withEnv({ CORS_ALLOWED_ORIGINS: 'https://app.example.com' }, () => {
    const req = new Request('https://fn.example.com/');
    const h = corsHeadersFor(req);
    assertEquals(h['Access-Control-Allow-Origin'] === '*', false);
  });
});

Deno.test('isOriginAllowed honors allowlist', () => {
  withEnv({ CORS_ALLOWED_ORIGINS: 'https://app.example.com' }, () => {
    assertEquals(isOriginAllowed('https://app.example.com'), true);
    assertEquals(isOriginAllowed('https://evil.example.com'), false);
    assertEquals(isOriginAllowed(null), false);
  });
});
