// Re-run the CURRENT Shopify→JIM derivation against lines already parked in
// shopify_quarantined_lines, without needing a fresh Shopify pull.
//
// The daily pull dedupes against shopify_bundle_source_orders, so once an order
// has been processed its quarantined lines never re-derive on their own. This
// admin/ops action lets us test the live matcher (shared ../_shared/shopifyDerive.ts,
// identical to shopify-pull-orders) against the existing backlog: every open line
// that now derives is resolved exactly as the manual resolver does — via the
// resolve_shopify_quarantined_line RPC (folds the qty into its bundle order and
// writes the variant mapping). Lines that still don't derive stay open, with the
// reason reported back.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersFor } from '../_shared/cors.ts';
import { buildProductIndex, deriveProduct } from '../_shared/shopifyDerive.ts';

const FUNCTION_VERSION = '1.0-rederive';

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

interface SourceResult {
  source_id: string;
  store_slug: string;
  total_open: number;
  resolved: number;
  still_failing: number;
  failures: { order: string | null; title: string | null; variant_title: string | null; reason: string }[];
}

console.log(`shopify-rederive-quarantine boot, version ${FUNCTION_VERSION}`);

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Service-role client for reads (bypasses the ADMIN-only RLS on shopify_sources).
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Auth: ADMIN/OPS user only. This is an interactive action — no cron/service path.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || token === serviceRoleKey) {
    return json({ error: 'Unauthorized: user JWT required' }, 401, corsHeaders);
  }
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: 'Unauthorized' }, 401, corsHeaders);
  const { data: roleData } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (roleData?.role !== 'ADMIN' && roleData?.role !== 'OPS') {
    return json({ error: 'Forbidden: ADMIN or OPS only' }, 403, corsHeaders);
  }

  // User-scoped client: the resolve RPC is SECURITY DEFINER but gates on
  // has_role(auth.uid()) and stamps resolved_by — so it must run as the caller,
  // not the service role (whose auth.uid() is null).
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  let body: { source_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body = all active sources
  }

  let srcQuery = admin
    .from('shopify_sources')
    .select('id, store_slug, linked_account_id, is_active')
    .eq('is_active', true);
  if (body.source_id) srcQuery = srcQuery.eq('id', body.source_id);
  const { data: sources, error: srcErr } = await srcQuery;
  if (srcErr) return json({ error: srcErr.message }, 500, corsHeaders);
  if (!sources || sources.length === 0) {
    return json({ version: FUNCTION_VERSION, message: 'No active sources', results: [] }, 200, corsHeaders);
  }

  const results: SourceResult[] = [];
  for (const source of sources) {
    const res: SourceResult = {
      source_id: source.id,
      store_slug: source.store_slug,
      total_open: 0,
      resolved: 0,
      still_failing: 0,
      failures: [],
    };

    // Products for this source's client (keyed on account_id; client_id is null).
    const { data: products, error: prodErr } = await admin
      .from('products')
      .select('id, sku, product_name, bag_size_g')
      .eq('account_id', source.linked_account_id);
    if (prodErr) {
      res.failures.push({ order: null, title: null, variant_title: null, reason: `product lookup: ${prodErr.message}` });
      results.push(res);
      continue;
    }
    const index = buildProductIndex(products ?? []);

    const { data: lines, error: lineErr } = await admin
      .from('shopify_quarantined_lines')
      .select('id, shopify_order_number, shopify_product_title, shopify_variant_title, shopify_sku')
      .eq('source_id', source.id)
      .eq('status', 'open');
    if (lineErr) {
      res.failures.push({ order: null, title: null, variant_title: null, reason: `line lookup: ${lineErr.message}` });
      results.push(res);
      continue;
    }

    res.total_open = (lines ?? []).length;
    for (const l of lines ?? []) {
      const dr = deriveProduct(
        { title: l.shopify_product_title, variantTitle: l.shopify_variant_title, sku: l.shopify_sku },
        index,
      );
      if (!dr.ok) {
        res.still_failing++;
        if (res.failures.length < 100) {
          res.failures.push({
            order: l.shopify_order_number,
            title: l.shopify_product_title,
            variant_title: l.shopify_variant_title,
            reason: dr.reason,
          });
        }
        continue;
      }
      // Resolve exactly as the manual resolver does (fold into bundle + map variant).
      const { error: rpcErr } = await userClient.rpc('resolve_shopify_quarantined_line', {
        p_line_id: l.id,
        p_jim_product_id: dr.productId,
      });
      if (rpcErr) {
        res.still_failing++;
        if (res.failures.length < 100) {
          res.failures.push({
            order: l.shopify_order_number,
            title: l.shopify_product_title,
            variant_title: l.shopify_variant_title,
            reason: `resolve failed: ${rpcErr.message}`,
          });
        }
      } else {
        res.resolved++;
      }
    }
    results.push(res);
  }

  return json({ version: FUNCTION_VERSION, results }, 200, corsHeaders);
});
