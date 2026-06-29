// Pull unfulfilled orders from Shopify and create one batched JIM order per source.
//
// Called two ways:
//  - pg_cron (daily, 6am PDT) with the service_role key — trigger_type 'scheduled'
//  - Admin/Ops UI with a user JWT (ADMIN or OPS role required) — trigger_type 'manual'
//
// Per active shopify_source:
//  1. Fetch open, unfulfilled orders from the Shopify Admin GraphQL API.
//  2. Skip orders already linked in shopify_bundle_source_orders (dedupe across runs).
//  3. Resolve EACH line item to a JIM product:
//       a. shopify_product_mappings override keyed on shopify_variant_id wins —
//          jim_product_id maps it, do_not_produce silently drops it.
//       b. otherwise derive: parse bag size (grams) from the variant title, parse
//          the 5-letter SKU family from the line SKU, and match the one JIM product
//          for this source's client with equal bag_size_g and the same family
//          segment in its SKU. Origin segments (BLD/ETH/XXX) are ignored.
//  4. LINE-LEVEL quarantine: lines that resolve flow into ONE bundle order (status
//     SUBMITTED, aggregated by product + grind). Lines that don't resolve are parked
//     in shopify_quarantined_lines — the rest of their order still bundles normally.
//  5. Record the attempt in shopify_pull_log.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersFor } from '../_shared/cors.ts';
import { decryptSecret, looksEncrypted } from '../_shared/crypto.ts';

const SHOPIFY_API_VERSION = '2025-01';
// Bump on schema-affecting changes; echoed in responses/logs to verify deploys.
const FUNCTION_VERSION = '3.1-quarantine-logging';

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
  customerName: string | null; // null when Protected Customer Data access not granted
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
  if (source.api_access_token) {
    const raw = source.api_access_token;
    // Tokens from the OAuth install flow are AES-256-GCM encrypted with the
    // bare shop host as AAD; legacy custom-app shpat_ tokens are plaintext.
    if (looksEncrypted(raw)) {
      return await decryptSecret(raw, shopHost(source.store_url));
    }
    return raw;
  }
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
            customer { displayName }  # requires read_customers scope
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
        customerName: node.customer?.displayName ?? null,
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

// The product-family portion of a SKU: the 5-letter middle segment (HEAVY, AMIWR,
// PEOPL, RINGS …). JIM SKUs look like NSC-BLD-HEAVY-01000; the origin segment
// (BLD/ETH/XXX, 3 letters) is inconsistent between Shopify and JIM, so it's ignored.
function skuFamily(sku: string | null): string | null {
  if (!sku) return null;
  const segs = sku.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  for (const s of segs) if (/^[A-Z]{5}$/.test(s)) return s;
  return null;
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

interface PullResult {
  source_id: string;
  store_slug: string;
  result: 'success' | 'partial' | 'error';
  orders_retrieved: number;
  orders_included: number;
  orders_quarantined: number;
  lines_quarantined?: number;
  order_id?: string;
  order_number?: string;
  error?: string;
}

async function pullSource(
  admin: SupabaseClient,
  source: {
    id: string;
    store_slug: string;
    store_name: string;
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

  // Pull-log row first so the created order and quarantine rows can reference it.
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
    const { error: updErr } = await admin
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
    if (updErr) console.error(`pull_log finalize update failed: ${updErr.message}`);
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

    // Variant-keyed overrides: jim_product_id maps a line; do_not_produce drops it.
    // Product-level (variant-null) and SKU matching are intentionally NOT used —
    // derivation handles those deterministically.
    const { data: mappings, error: mapErr } = await admin
      .from('shopify_product_mappings')
      .select('shopify_variant_id, jim_product_id, do_not_produce')
      .eq('source_id', source.id);
    if (mapErr) throw new Error(`mapping lookup failed: ${mapErr.message}`);
    const byVariant = new Map<string, string>();
    const doNotProduce = new Set<string>();
    for (const m of mappings ?? []) {
      if (!m.shopify_variant_id) continue;
      if (m.do_not_produce) {
        doNotProduce.add(m.shopify_variant_id);
        continue;
      }
      if (m.jim_product_id) byVariant.set(m.shopify_variant_id, m.jim_product_id);
    }

    // Account products, indexed by (SKU family | bag size) for derivation.
    const { data: acctProducts, error: prodErr } = await admin
      .from('products')
      .select('id, sku, bag_size_g')
      .eq('account_id', source.linked_account_id);
    if (prodErr) throw new Error(`product lookup failed: ${prodErr.message}`);
    const byFamilyGrams = new Map<string, string[]>();
    for (const p of acctProducts ?? []) {
      const fam = skuFamily(p.sku);
      if (!fam || p.bag_size_g == null) continue;
      const key = `${fam}|${p.bag_size_g}`;
      const arr = byFamilyGrams.get(key) ?? [];
      arr.push(p.id);
      byFamilyGrams.set(key, arr);
    }

    type LineFate =
      | { kind: 'product'; productId: string }
      | { kind: 'skip' }
      | { kind: 'quarantine' };

    const classify = (li: ShopifyLineItem): LineFate => {
      // Overrides win, keyed on the variant id.
      if (li.variantId) {
        if (doNotProduce.has(li.variantId)) return { kind: 'skip' };
        const mapped = byVariant.get(li.variantId);
        if (mapped) return { kind: 'product', productId: mapped };
      }
      // Derive by bag size + SKU family (unique match only).
      const grams = parseGrams(li.variantTitle);
      const fam = skuFamily(li.sku);
      if (grams != null && fam) {
        const ids = byFamilyGrams.get(`${fam}|${grams}`);
        if (ids && ids.length === 1) return { kind: 'product', productId: ids[0] };
      }
      return { kind: 'quarantine' };
    };

    // Partition every producible line: resolved → bundle aggregate; unresolved →
    // quarantine; do-not-produce → dropped. An order is "included" once any of its
    // lines resolves; its quarantined lines then reference the shared bundle order.
    const bundleLines = new Map<string, { productId: string; grind: string | null; qty: number }>();
    const includedOrders: ShopifyOrder[] = [];
    const orderHasResolved = new Map<string, boolean>();
    const quarantineByOrder = new Map<string, ShopifyLineItem[]>();

    for (const o of newOrders) {
      let resolvedAny = false;
      const qLines: ShopifyLineItem[] = [];
      for (const li of o.lineItems) {
        if (li.unfulfilledQuantity <= 0) continue;
        const fate = classify(li);
        if (fate.kind === 'skip') continue;
        if (fate.kind === 'product') {
          resolvedAny = true;
          const grind = parseGrind(li.variantTitle);
          const key = `${fate.productId}|${grind ?? ''}`;
          const entry = bundleLines.get(key) ?? { productId: fate.productId, grind, qty: 0 };
          entry.qty += li.unfulfilledQuantity;
          bundleLines.set(key, entry);
        } else {
          qLines.push(li);
        }
      }
      orderHasResolved.set(o.id, resolvedAny);
      if (resolvedAny) includedOrders.push(o);
      if (qLines.length > 0) quarantineByOrder.set(o.id, qLines);
    }

    // Create the bundle order from all resolved lines (if any).
    let bundleOrderId: string | null = null;
    let bundleOrderNumber: string | undefined;
    if (bundleLines.size > 0) {
      const productIds = [...new Set([...bundleLines.values()].map((e) => e.productId))];
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

      const summarizeItems = (o: ShopifyOrder): string =>
        o.lineItems
          .filter((li) => (li.unfulfilledQuantity ?? li.quantity) > 0)
          .map((li) => {
            const qty = li.unfulfilledQuantity ?? li.quantity;
            const label = [li.title, li.variantTitle].filter(Boolean).join(' / ');
            return `${qty}× ${label}`;
          })
          .join(', ');
      const orderLines = includedOrders
        .map((o) => {
          const who = o.customerName ? ` - ${o.customerName}` : '';
          const items = summarizeItems(o);
          return `${o.name}${who}${items ? `: ${items}` : ''}`;
        })
        .join('\n');
      const quarantinedLineCount = [...quarantineByOrder.values()].reduce((n, l) => n + l.length, 0);
      const notes =
        `Shopify daily pull (${source.store_name})\n${includedOrders.length} unfulfilled order(s)\n${orderLines}` +
        (quarantinedLineCount > 0
          ? `\n\n${quarantinedLineCount} line(s) quarantined (unmatched variant) — resolve in the Shopify quarantine screen.`
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
      bundleOrderId = order.id;
      bundleOrderNumber = order.order_number;

      const { data: shipment, error: shipErr } = await admin
        .from('order_shipments')
        .insert({ order_id: order.id, shipment_number: 1, delivery_method: 'PICKUP' })
        .select('id')
        .single();
      if (shipErr) throw new Error(`shipment insert failed: ${shipErr.message}`);

      const lineItems = [...bundleLines.values()].map((entry) => ({
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
        includedOrders.map((o) => ({
          source_id: source.id,
          shopify_order_id: o.id,
          shopify_order_number: o.name,
          shopify_created_at: o.createdAt,
          customer_name: o.customerName,
          bundle_order_id: order.id,
          pull_log_id: pullLogId,
          line_items: o.lineItems
            .filter((li) => li.unfulfilledQuantity > 0)
            .map((li) => ({
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
    }

    // Insert quarantine rows for unresolved lines, skipping any already-open row for
    // the same (order, variant). bundle_order_id is the shared bundle iff this order
    // contributed resolved lines, else null.
    //
    // This is deliberately NON-fatal: a quarantine failure must not throw away the
    // bundle order that was just created, and the failure must be visible. Any error
    // is captured into pull_log.details (and error_message) rather than swallowed.
    let linesAttempted = 0;
    let linesQuarantined = 0;
    let quarantineError: string | null = null;
    if (quarantineByOrder.size > 0) {
      try {
        const orderIds = [...quarantineByOrder.keys()];
        const { data: openRows, error: openErr } = await admin
          .from('shopify_quarantined_lines')
          .select('shopify_order_id, shopify_variant_id')
          .eq('source_id', source.id)
          .eq('status', 'open')
          .in('shopify_order_id', orderIds);
        if (openErr) throw new Error(`lookup failed: ${openErr.message}`);
        const openKey = new Set(
          (openRows ?? []).map((r) => `${r.shopify_order_id}|${r.shopify_variant_id ?? ''}`),
        );

        const qRows: Record<string, unknown>[] = [];
        for (const o of newOrders) {
          const lines = quarantineByOrder.get(o.id);
          if (!lines) continue;
          const bId = orderHasResolved.get(o.id) ? bundleOrderId : null;
          for (const li of lines) {
            const key = `${o.id}|${li.variantId ?? ''}`;
            if (openKey.has(key)) continue;
            openKey.add(key);
            qRows.push({
              source_id: source.id,
              pull_log_id: pullLogId,
              bundle_order_id: bId,
              shopify_order_id: o.id,
              shopify_order_number: o.name,
              customer_name: o.customerName,
              shopify_product_id: li.productId,
              shopify_variant_id: li.variantId,
              shopify_product_title: li.title,
              shopify_variant_title: li.variantTitle,
              shopify_sku: li.sku,
              quantity: li.unfulfilledQuantity,
              reason: 'no_match',
              status: 'open',
            });
          }
        }
        linesAttempted = qRows.length;
        // Insert one row at a time so a single bad row (e.g. a transient unique-index
        // race) can't drop the whole batch, and so the failing row is identifiable.
        for (const row of qRows) {
          const { error: qErr } = await admin.from('shopify_quarantined_lines').insert(row);
          if (qErr) {
            // 23505 = unique_violation: an open row already exists, treat as written.
            if (qErr.code === '23505') {
              linesQuarantined++;
              continue;
            }
            throw new Error(
              `insert failed for ${row.shopify_order_number}/${row.shopify_variant_id}: ${qErr.message}`,
            );
          }
          linesQuarantined++;
        }
      } catch (e) {
        quarantineError = e instanceof Error ? e.message : String(e);
        console.error(`[${source.store_slug}] quarantine write failed: ${quarantineError}`);
      }
    }

    // orders_quarantined = orders still carrying ≥1 open quarantined line this run.
    const ordersQuarantined = quarantineByOrder.size;

    const summaryError = quarantineError
      ? `Quarantine write FAILED: ${quarantineError}`
      : ordersQuarantined > 0
        ? `${linesQuarantined} quarantined line(s) across ${ordersQuarantined} order(s)`
        : undefined;

    return await finalize(
      {
        orders_retrieved: shopifyOrders.length,
        orders_included: includedOrders.length,
        orders_quarantined: ordersQuarantined,
        lines_quarantined: linesQuarantined,
        result: quarantineError ? 'error' : ordersQuarantined > 0 ? 'partial' : 'success',
        order_id: bundleOrderId ?? undefined,
        order_number: bundleOrderNumber,
        error: summaryError,
      },
      {
        quarantined_orders: ordersQuarantined,
        quarantined_lines_attempted: linesAttempted,
        quarantined_lines_written: linesQuarantined,
        quarantine_error: quarantineError,
      },
    );
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

  // Auth: service_role key (cron) or ADMIN/OPS user JWT (manual trigger).
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
    if (roleData?.role !== 'ADMIN' && roleData?.role !== 'OPS') {
      return json({ error: 'Forbidden: ADMIN or OPS only' }, 403, corsHeaders);
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
      'id, store_slug, store_name, store_url, linked_account_id, api_access_token, oauth_client_id, oauth_client_secret, is_active',
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
