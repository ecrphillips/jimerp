// Shared Shopify → JIM product derivation.
//
// SINGLE SOURCE OF TRUTH for matching a Shopify order line to a JIM product. Both
// the daily pull (shopify-pull-orders) and the re-derive action
// (shopify-rederive-quarantine) import this so their matching logic can never
// drift. Pure functions — no I/O.

export interface DerivableLine {
  title: string | null;
  variantTitle: string | null; // e.g. "250 G / Whole Bean"
  sku: string | null; // usually null on No Smoke lines
}

export interface ProductRow {
  id: string;
  sku: string | null;
  product_name: string | null;
  bag_size_g: number | null;
}

// Parse grams from a variant title: "250 G" = 250, "1 KG" = 1000, "2 KG" = 2000.
export function parseGrams(variantTitle: string | null): number | null {
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
// (BLD/ETH/XXX) is inconsistent between Shopify and JIM, so it's ignored.
export function skuFamily(sku: string | null): string | null {
  if (!sku) return null;
  const segs = sku.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  for (const s of segs) if (/^[A-Z]{5}$/.test(s)) return s;
  return null;
}

// Normalise a product name to its family for matching: case-insensitive, with bag
// sizes ("1kg", "250 g", "2 KG") and packaging descriptors ("Bulk", "Retail", …)
// stripped, then non-alphanumerics removed. So the Shopify title "People Pleaser"
// and the JIM name "People Pleaser 1kg Bulk" both collapse to "peoplepleaser",
// while unsuffixed names ("Sacred Garden") are unaffected.
export function normProductName(s: string | null): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:kgs?|g|gr|grams?|lbs?|oz)\b/g, ' ') // bag sizes
    .replace(/\b(?:bulk|retail|wholesale|sample|samples|bag|bags|case|cases|box|boxes|pouch|tin)\b/g, ' ') // packaging
    .replace(/[^a-z0-9]+/g, '');
}

export interface ProductIndex {
  byNameGrams: Map<string, string[]>;
  byFamilyGrams: Map<string, string[]>;
}

// Index account products for derivation. Caller selects products by account_id
// (their client_id is null, so a client_id filter finds nothing).
export function buildProductIndex(products: ProductRow[]): ProductIndex {
  const byNameGrams = new Map<string, string[]>();
  const byFamilyGrams = new Map<string, string[]>();
  for (const p of products) {
    if (p.bag_size_g == null) continue;
    const n = normProductName(p.product_name);
    if (n) {
      const key = `${n}|${p.bag_size_g}`;
      const arr = byNameGrams.get(key) ?? [];
      arr.push(p.id);
      byNameGrams.set(key, arr);
    }
    const fam = skuFamily(p.sku);
    if (fam) {
      const key = `${fam}|${p.bag_size_g}`;
      const arr = byFamilyGrams.get(key) ?? [];
      arr.push(p.id);
      byFamilyGrams.set(key, arr);
    }
  }
  return { byNameGrams, byFamilyGrams };
}

export type DeriveResult = { ok: true; productId: string } | { ok: false; reason: string };

// Derive a JIM product id from a Shopify line. Primary key: normalised title vs
// normalised product_name + bag size. Secondary: SKU family + bag size (only when
// the line carries a SKU). Returns a reason string when nothing resolves.
export function deriveProduct(line: DerivableLine, idx: ProductIndex): DeriveResult {
  const grams = parseGrams(line.variantTitle);
  if (grams == null) return { ok: false, reason: 'no_bag_size' };

  const nkey = normProductName(line.title);
  if (nkey) {
    const ids = idx.byNameGrams.get(`${nkey}|${grams}`);
    if (ids && ids.length === 1) return { ok: true, productId: ids[0] };
    if (ids && ids.length > 1) return { ok: false, reason: 'ambiguous_name' };
  }

  const fam = skuFamily(line.sku);
  if (fam) {
    const ids = idx.byFamilyGrams.get(`${fam}|${grams}`);
    if (ids && ids.length === 1) return { ok: true, productId: ids[0] };
  }

  return { ok: false, reason: nkey ? 'no_name_match' : 'no_name' };
}
