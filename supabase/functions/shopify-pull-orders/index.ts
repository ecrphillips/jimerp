// Pull unfulfilled orders from Shopify and create one batched JIM order per source.
//
// Called two ways:
//  - pg_cron (daily, 6am PDT) with the service_role key — trigger_type 'scheduled'
//  - Admin UI with a user JWT (ADMIN role required) — trigger_type 'manual'
//
// Per active shopify_source:
//  1. Fetch open, unfulfilled orders from the Shopify Admin GraphQL API.
//  2. Skip orders already linked in shopify_bundle_source_orders (dedupe across runs).
//  3. Map line items to internal products via shopify_product_mappings, falling back
//     to SKU match, then to auto-matching by normalized product name + bag size parsed
//     from the variant title. Auto-matches persist a mapping row and write the JIM SKU
//     back onto the Shopify variant (requires write_products scope). Orders containing
//     any unmapped item are quarantined (counted, retried next run once a mapping exists).
//  4. Create ONE order (source_channel 'shopify_auto', status SUBMITTED) with line
//     items aggregated by product, plus a primary shipment, and link each included
//     Shopify order in shopify_bundle_source_orders.
//  5. Record the attempt in shopify_pull_log.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersFor } from '../_shared/cors.ts';

const SHOPIFY_API_VERSION = '2025-01';
// Bump on schema-affecting changes; echoed in responses/logs to verify deploys.
const FUNCTION_VERSION = '2.3-mapped_by';

interface ShopifyLineItem {
  sku: string | null;
  title: string;
  variantTitle: string | null; // e.g. "250 G / Whole Bean"
  quantity: number;
  unfulfilledQuantity: number;
  productId: string | null; // legacy numeric id as text
  variantId: string | null; // legacy numeric id as text
}

interface ShopifyOrder {
  id: string; // legacy numeric id as text
  name: string; // e.g. #1001
  createdAt: string | null;
  lineItems: ShopifyLineItem[];
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function shopHost(storeUrl: string): string {
  return storeUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

// Dev Dashboard apps don't have permanent shpat_ tokens — exchange client
// credentials for a short-lived (24h) Admin API access token at pull time.
// Legacy admin-created custom apps still pass a permanent shpat_ token through.
async function resolveAccessToken(source: {
  store_url: string;
  api_access_token: string | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
}): Promise<string> {
  if (source.oauth_client_id && source.oauth_client_secret) {
    const res = await fetch(`https://${shopHost(source.store_url)}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: source.oauth_client_id,
        client_secret: source.oauth_client_secret,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`token exchange failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const payload = await res.json();
    if (!payload.access_token) throw new Error('token exchange returned no access_token');
    return payload.access_token as string;
  }
  if (source.api_access_token) return source.api_access_token;
  throw new Error('No credentials: set oauth_client_id/oauth_client_secret or api_access_token');
}

function legacyId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = String(gid).match(/\/(\d+)$/);
  return m ? m[1] : String(gid);
}

async function fetchUnfulfilledOrders(
  storeUrl: string,
  accessToken: string,
): Promise<ShopifyOrder[]> {
  const endpoint = `https://${shopHost(storeUrl)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const orders: ShopifyOrder[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 10; page++) {
    const query = `
      query PullUnfulfilled($cursor: String) {
        orders(first: 100, after: $cursor, query: "status:open AND fulfillment_status:unfulfilled") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            name
            createdAt
            lineItems(first: 100) {
              nodes {
                sku
                title
                quantity
                unfulfilledQuantity
                product { id }
                variant { id title }
              }
            }
          }
        }
      }`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API ${res.status}: ${text.slice(0, 300)}`);
    }

    const payload = await res.json();
    if (payload.errors?.length) {
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(payload.errors).slice(0, 300)}`);
    }

    const conn = payload.data?.orders;
    for (const node of conn?.nodes ?? []) {
      orders.push({
        id: legacyId(node.id)!,
        name: node.name,
        createdAt: node.createdAt ?? null,
        lineItems: (node.lineItems?.nodes ?? []).map((li: Record<string, unknown>) => ({
          sku: (li.sku as string) || null,
          title: (li.title as string) ?? '',
          variantTitle: (li.variant as { title?: string } | null)?.title ?? null,
          quantity: (li.quantity as number) ?? 0,
          unfulfilledQuantity: (li.unfulfilledQuantity as number) ?? (li.quantity as number) ?? 0,
          productId: legacyId((li.product as { id?: string } | null)?.id),
          variantId: legacyId((li.variant as { id?: string } | null)?.id),
        })),
      });
    }

    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  return orders;
}

// "Am I Wrong" → "AMIWRONG" — tolerant of punctuation/case/spacing drift.
function normalizeName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Parse grams from a variant title like "250 G / Whole Bean" or "1 KG / Cone Drip".
function parseGrams(variantTitle: string | null): number | null {
  if (!variantTitle) return null;
  const m = variantTitle.match(/([\d.]+)\s*(KG|G|LB)/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].toUpperCase();
  if (unit === 'KG') return Math.round(value * 1000);
  if (unit === 'LB') return Math.round(value * 454);
  return Math.round(value);
}

// Map a Shopify grind option to the JIM grind_option enum.
function parseGrind(variantTitle: string | null): 'WHOLE_BEAN' | 'ESPRESSO' | 'FILTER' | null {
  if (!variantTitle) return null;
  const t = variantTitle.toUpperCase();
  if (t.includes('WHOLE BEAN')) return 'WHOLE_BEAN';
  if (t.includes('ESPRESSO')) return 'ESPRESSO';
  if (t.includes('DRIP') || t.includes('FRENCH PRESS') || t.includes('FILTER') || t.includes('POUR OVER')) {
    return 'FILTER';
  }
  return null;
}

// Write JIM SKUs back onto Shopify variants so the variant carries the join key.
// Best-effort: requires write_products scope; failures are reported, not fatal.
async function pushSkusToShopify(
  storeUrl: string,
  accessToken: string,
  updates: { shopifyProductId: string; shopifyVariantId: string; sku: string }[],
): Promise<string | null> {
  const endpoint = `https://${shopHost(storeUrl)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const byProduct = new Map<string, { id: string; inventoryItem: { sku: string } }[]>();
  for (const u of updates) {
    const list = byProduct.get(u.shopifyProductId) ?? [];
    list.push({
      id: `gid://shopify/ProductVariant/${u.shopifyVariantId}`,
      inventoryItem: { sku: u.sku },
    });
    byProduct.set(u.shopifyProductId, list);
  }

  const errors: string[] = [];
  for (const [productId, variants] of byProduct) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: `
          mutation SyncSkus($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }`,
        variables: { productId: `gid://shopify/Product/${productId}`, variants },
      }),
    });
    if (!res.ok) {
      errors.push(`product ${productId}: HTTP ${res.status}`);
      continue;
    }
    const payload = await res.json();
    const userErrors = payload.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (payload.errors?.length) errors.push(`product ${productId}: ${JSON.stringify(payload.errors).slice(0, 200)}`);
    if (userErrors.length) errors.push(`product ${productId}: ${JSON.stringify(userErrors).slice(0, 200)}`);
  }
  return errors.length > 0 ? errors.join('; ') : null;
}

interface PullResult {
  source_id: string;
  store_slug: string;
  result: 'success' | 'partial' | 'error';
  orders_retrieved: number;
  orders_included: number;
  orders_quarantined: number;
  order_id?: string;
  order_number?: string;
  error?: string;
}

async function pullSource(
  admin: SupabaseClient,
  source: {
    id: string;
    store_slug: string;
    store_url: string;
    linked_account_id: string;
    api_access_token: string | null;
    oauth_client_id: string | null;
    oauth_client_secret: string | null;
  },
  triggerType: 'manual' | 'scheduled',
): Promise<PullResult> {
  const base: PullResult = {
    source_id: source.id,
    store_slug: source.store_slug,
    result: 'success',
    orders_retrieved: 0,
    orders_included: 0,
    orders_quarantined: 0,
  };

  // Pull-log row first so the created order can reference it.
  const { data: logRow, error: logErr } = await admin
    .from('shopify_pull_log')
    .insert({
      source_id: source.id,
      result: 'success',
      trigger_type: triggerType,
    })
    .select('id')
    .single();
  if (logErr || !logRow) {
    return { ...base, result: 'error', error: `pull_log insert failed: ${logErr?.message}` };
  }
  const pullLogId = logRow.id as string;

  const finalize = async (patch: Partial<PullResult>, details?: unknown): Promise<PullResult> => {
    const out = { ...base, ...patch };
    await admin
      .from('shopify_pull_log')
      .update({
        result: out.result,
        orders_retrieved: out.orders_retrieved,
        orders_included: out.orders_included,
        orders_quarantined: out.orders_quarantined,
        error_message: out.error ?? null,
        generated_order_id: out.order_id ?? null,
        completed_at: new Date().toISOString(),
        ...(details !== undefined ? { details } : {}),
      })
      .eq('id', pullLogId);
    return out;
  };

  try {
    const accessToken = await resolveAccessToken(source);
    const shopifyOrders = await fetchUnfulfilledOrders(source.store_url, accessToken);

    // Dedupe against orders already bundled in prior runs.
    const { data: existing, error: existErr } = await admin
      .from('shopify_bundle_source_orders')
      .select('shopify_order_id')
      .eq('source_id', source.id);
    if (existErr) throw new Error(`bundle lookup failed: ${existErr.message}`);
    const seen = new Set((existing ?? []).map((r) => r.shopify_order_id));
    const newOrders = shopifyOrders.filter((o) => !seen.has(o.id));

    if (newOrders.length === 0) {
      return await finalize({ orders_retrieved: shopifyOrders.length });
    }

    // Mapping table: variant-level beats product-level. do_not_produce variants
    // are intentionally excluded from JIM orders (not quarantined).
    const { data: mappings, error: mapErr } = await admin
      .from('shopify_product_mappings')
      .select('shopify_product_id, shopify_variant_id, jim_product_id, do_not_produce')
      .eq('source_id', source.id);
    if (mapErr) throw new Error(`mapping lookup failed: ${mapErr.message}`);
    const byVariant = new Map<string, string>();
    const byProduct = new Map<string, string>();
    const doNotProduce = new Set<string>();
    for (const m of mappings ?? []) {
      if (m.do_not_produce && m.shopify_variant_id) {
        doNotProduce.add(m.shopify_variant_id);
        continue;
      }
      if (!m.jim_product_id) continue;
      if (m.shopify_variant_id) byVariant.set(m.shopify_variant_id, m.jim_product_id);
      else byProduct.set(m.shopify_product_id, m.jim_product_id);
    }

    // Account products: used for SKU fallback and name+size auto-matching.
    const { data: acctProducts, error: prodErr } = await admin
      .from('products')
      .select('id, sku, product_name, bag_size_g')
      .eq('account_id', source.linked_account_id);
    if (prodErr) throw new Error(`product lookup failed: ${prodErr.message}`);
    const bySku = new Map<string, string>();
    for (const p of acctProducts ?? []) {
      if (p.sku) bySku.set(p.sku.trim().toUpperCase(), p.id);
    }

    const resolve = (li: ShopifyLineItem): string | null =>
      (li.variantId && byVariant.get(li.variantId)) ||
      (li.productId && byProduct.get(li.productId)) ||
      (li.sku && bySku.get(li.sku.trim().toUpperCase())) ||
      null;

    // Auto-map unresolved variants by normalized product name + bag size, so new
    // Shopify products never need manual transposition. A unique match persists a
    // mapping row and queues the JIM SKU for write-back to the Shopify variant.
    const newMappings: {
      source_id: string;
      shopify_product_id: string;
      shopify_variant_id: string;
      jim_product_id: string;
      mapped_at: string;
      notes: string;
      shopify_product_title: string;
      shopify_sku: string | null;
    }[] = [];
    const skuPushes: { shopifyProductId: string; shopifyVariantId: string; sku: string }[] = [];
    const attempted = new Set<string>();
    for (const o of newOrders) {
      for (const li of o.lineItems) {
        if (li.unfulfilledQuantity <= 0 || resolve(li)) continue;
        if (!li.variantId || !li.productId || attempted.has(li.variantId)) continue;
        if (doNotProduce.has(li.variantId)) continue;
        attempted.add(li.variantId);
        const wantName = normalizeName(li.title);
        const wantGrams = parseGrams(li.variantTitle);
        if (!wantName || wantGrams == null) continue;
        const candidates = (acctProducts ?? []).filter(
          (p) => normalizeName(p.product_name ?? '') === wantName && p.bag_size_g === wantGrams,
        );
        if (candidates.length !== 1) continue;
        const match = candidates[0];
        byVariant.set(li.variantId, match.id);
        newMappings.push({
          source_id: source.id,
          shopify_product_id: li.productId,
          shopify_variant_id: li.variantId,
          jim_product_id: match.id,
          mapped_at: new Date().toISOString(),
          notes: 'auto-mapped by product name + bag size',
          shopify_product_title: li.title,
          shopify_sku: li.sku,
        });
        if (match.sku) {
          skuPushes.push({
            shopifyProductId: li.productId,
            shopifyVariantId: li.variantId,
            sku: match.sku,
          });
        }
      }
    }

    let skuPushError: string | null = null;
    if (newMappings.length > 0) {
      const { error: insErr } = await admin
        .from('shopify_product_mappings')
        .insert(newMappings);
      if (insErr) throw new Error(`mapping insert failed: ${insErr.message}`);
      if (skuPushes.length > 0) {
        skuPushError = await pushSkusToShopify(source.store_url, accessToken, skuPushes);
      }
    }

    // Partition orders: fully mappable vs quarantined.
    const included: ShopifyOrder[] = [];
    const quarantined: { order: ShopifyOrder; unmapped: string[] }[] = [];
    const producible = (li: ShopifyLineItem) =>
      li.unfulfilledQuantity > 0 && !(li.variantId && doNotProduce.has(li.variantId));
    for (const o of newOrders) {
      const items = o.lineItems.filter(producible);
      const unmapped = items.filter((li) => !resolve(li)).map((li) => li.sku || li.title);
      if (items.length === 0) continue; // nothing left to fulfill
      if (unmapped.length > 0) quarantined.push({ order: o, unmapped });
      else included.push(o);
    }

    if (included.length === 0) {
      return await finalize({
        orders_retrieved: shopifyOrders.length,
        orders_quarantined: quarantined.length,
        result: quarantined.length > 0 ? 'partial' : 'success',
        error: quarantined.length > 0
          ? `Quarantined ${quarantined.length} order(s) with unmapped items: ${quarantined.map((q) => `${q.order.name} [${q.unmapped.join(', ')}]`).join('; ').slice(0, 500)}`
          : undefined,
      });
    }

    // Aggregate quantities by internal product + grind across all included orders.
    const qtyByLine = new Map<string, { productId: string; grind: string | null; qty: number }>();
    for (const o of included) {
      for (const li of o.lineItems) {
        if (!producible(li)) continue;
        const productId = resolve(li)!;
        const grind = parseGrind(li.variantTitle);
        const key = `${productId}|${grind ?? ''}`;
        const entry = qtyByLine.get(key) ?? { productId, grind, qty: 0 };
        entry.qty += li.unfulfilledQuantity;
        qtyByLine.set(key, entry);
      }
    }

    // Latest effective price per product; 0 if none.
    const productIds = [...new Set([...qtyByLine.values()].map((e) => e.productId))];
    const { data: prices, error: priceErr } = await admin
      .from('price_list')
      .select('product_id, unit_price, effective_date')
      .in('product_id', productIds)
      .lte('effective_date', new Date().toISOString().slice(0, 10))
      .order('effective_date', { ascending: false });
    if (priceErr) throw new Error(`price lookup failed: ${priceErr.message}`);
    const priceByProduct = new Map<string, number>();
    for (const p of prices ?? []) {
      if (!priceByProduct.has(p.product_id)) priceByProduct.set(p.product_id, Number(p.unit_price));
    }

    // Create the batched order.
    const orderNames = included.map((o) => o.name).join(', ');
    const notes =
      `Shopify daily pull (${source.store_slug}): ${included.length} unfulfilled order(s) — ${orderNames}` +
      (newMappings.length > 0 ? `\nAuto-mapped ${newMappings.length} new Shopify variant(s) by name+size.` : '') +
      (skuPushError ? `\nSKU write-back to Shopify failed (check write_products scope): ${skuPushError}` : '') +
      (quarantined.length > 0
        ? `\nQuarantined (unmapped items, will retry next pull): ${quarantined.map((q) => `${q.order.name} [${q.unmapped.join(', ')}]`).join('; ')}`
        : '');

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        order_number: '',
        account_id: source.linked_account_id,
        status: 'SUBMITTED',
        delivery_method: 'PICKUP',
        source_channel: 'shopify_auto',
        shopify_source_id: source.id,
        shopify_pull_log_id: pullLogId,
        client_notes: notes.slice(0, 2000),
        created_by_admin: true,
      })
      .select('id, order_number')
      .single();
    if (orderErr || !order) throw new Error(`order insert failed: ${orderErr?.message}`);

    const { data: shipment, error: shipErr } = await admin
      .from('order_shipments')
      .insert({ order_id: order.id, shipment_number: 1, delivery_method: 'PICKUP' })
      .select('id')
      .single();
    if (shipErr) throw new Error(`shipment insert failed: ${shipErr.message}`);

    const lineItems = [...qtyByLine.values()].map((entry) => ({
      order_id: order.id,
      product_id: entry.productId,
      quantity_units: entry.qty,
      unit_price_locked: priceByProduct.get(entry.productId) ?? 0,
      grind: entry.grind,
      shipment_id: shipment?.id ?? null,
    }));
    const { error: liErr } = await admin.from('order_line_items').insert(lineItems);
    if (liErr) throw new Error(`line item insert failed: ${liErr.message}`);

    const { error: bundleErr } = await admin.from('shopify_bundle_source_orders').insert(
      included.map((o) => ({
        source_id: source.id,
        shopify_order_id: o.id,
        shopify_order_number: o.name,
        shopify_created_at: o.createdAt,
        bundle_order_id: order.id,
        pull_log_id: pullLogId,
        line_items: o.lineItems.filter(producible).map((li) => ({
          sku: li.sku,
          title: li.title,
          variant_title: li.variantTitle,
          quantity: li.unfulfilledQuantity,
          shopify_product_id: li.productId,
          shopify_variant_id: li.variantId,
        })),
      })),
    );
    if (bundleErr) throw new Error(`bundle link insert failed: ${bundleErr.message}`);

    return await finalize({
      orders_retrieved: shopifyOrders.length,
      orders_included: included.length,
      orders_quarantined: quarantined.length,
      result: quarantined.length > 0 ? 'partial' : 'success',
      order_id: order.id,
      order_number: order.order_number,
      error: quarantined.length > 0
        ? `Quarantined ${quarantined.length} order(s) with unmapped items`
        : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return await finalize({ result: 'error', error: message.slice(0, 1000) });
  }
}

console.log(`shopify-pull-orders boot, version ${FUNCTION_VERSION}`);

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Auth: service_role key (cron) or ADMIN user JWT (manual trigger).
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  let triggerType: 'manual' | 'scheduled' = 'manual';

  if (token === serviceRoleKey) {
    triggerType = 'scheduled';
  } else {
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401, corsHeaders);
    const { data: roleData } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (roleData?.role !== 'ADMIN') {
      return json({ error: 'Forbidden: ADMIN only' }, 403, corsHeaders);
    }
  }

  let body: { source_id?: string; trigger?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  if (body.trigger === 'scheduled' && token === serviceRoleKey) triggerType = 'scheduled';

  let query = admin
    .from('shopify_sources')
    .select(
      'id, store_slug, store_url, linked_account_id, api_access_token, oauth_client_id, oauth_client_secret, is_active',
    )
    .eq('is_active', true);
  if (body.source_id) query = query.eq('id', body.source_id);

  const { data: sources, error: srcErr } = await query;
  if (srcErr) return json({ error: srcErr.message }, 500, corsHeaders);
  if (!sources || sources.length === 0) {
    return json(
      { message: 'No active Shopify sources', version: FUNCTION_VERSION, results: [] },
      200,
      corsHeaders,
    );
  }

  const results: PullResult[] = [];
  for (const source of sources) {
    if (!source.api_access_token && !(source.oauth_client_id && source.oauth_client_secret)) {
      results.push({
        source_id: source.id,
        store_slug: source.store_slug,
        result: 'error',
        orders_retrieved: 0,
        orders_included: 0,
        orders_quarantined: 0,
        error: 'No credentials: set oauth_client_id/oauth_client_secret or api_access_token',
      });
      continue;
    }
    results.push(await pullSource(admin, source as Parameters<typeof pullSource>[1], triggerType));
  }

  const anyError = results.some((r) => r.result === 'error');
  return json({ version: FUNCTION_VERSION, results }, anyError ? 207 : 200, corsHeaders);
});
