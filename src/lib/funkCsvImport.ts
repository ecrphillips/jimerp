// Pure logic for the FUNK CSV order importer (Build 1 of 2).
//
// Manual bridge until the Shopify connector is live. Everything here is
// side-effect free and unit-testable: CSV parsing, order grouping, the
// Perennial-subscription name cleaning, DROP-box detection, bag-size parsing
// and product matching. All DB writes live in the FunkImport page.

import type { Database } from '@/integrations/supabase/types';

type PackagingVariant = Database['public']['Enums']['packaging_variant'];

// ---------------------------------------------------------------------------
// CSV parsing (RFC-4180: quoted fields may contain commas and newlines)
// ---------------------------------------------------------------------------

/** Parse CSV text into rows of cells, handling quoted commas + embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  // Strip a leading BOM if present.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++; // escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      // Handle CRLF as a single break.
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  // Flush trailing cell/row (file may not end with a newline).
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully-empty rows (blank lines).
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export interface CsvLineItem {
  /** Raw "Lineitem name" from the export. */
  rawName: string;
  /** Name after Perennial-subscription cleaning (used for matching/display). */
  cleanedName: string;
  sku: string;
  quantity: number;
  /** True when this line is a Drip Drip DROP box. */
  isDrop: boolean;
  /** Can count read from a DROP-box name ("2 x 250g" -> 2); null if unparseable. */
  dropCans: number | null;
}

export interface CsvOrder {
  /** Shopify order number, e.g. "#1234" — present on every line of the order. */
  name: string;
  /** Long numeric Shopify "Id" captured from the order's first row. */
  shopifyId: string;
  /** Raw "Created at" value captured from the order's first row (may be ''). */
  createdAt: string;
  lineItems: CsvLineItem[];
}

const DROP_MARKER = 'drip drip drop';
const DROP_SUB_BOX = 'drip drip drop subscription box';

/** A Drip Drip DROP box line (the subscription box included). */
export function isDropName(name: string): boolean {
  return name.toLowerCase().includes(DROP_MARKER);
}

/**
 * Read the can count from a DROP-box name: "2 x 250g" -> 2, "4 x 250g" -> 4.
 * Returns null when the pattern can't be parsed (caller must not guess).
 */
export function parseDropCans(name: string): number | null {
  const m = /(\d+)\s*x\s*\d+\s*g/i.exec(name);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Perennial-subscription cleaning. If the name contains "Subscription" and is
 * NOT the "Drip Drip DROP Subscription Box", strip the word "Subscription" so
 * the line matches its retail twin (produced identically).
 *
 *   "Technicolour Subscription - 2LB bag / Whole Beans"
 *     -> "Technicolour - 2LB bag / Whole Beans"
 */
export function cleanSubscriptionName(name: string): string {
  const lower = name.toLowerCase();
  if (!lower.includes('subscription')) return name.trim();
  if (lower.includes(DROP_SUB_BOX)) return name.trim();
  return name
    .replace(/\bsubscription\b/gi, ' ')
    .replace(/\s+/g, ' ') // collapse whitespace left behind
    .replace(/\s+-\s+-\s+/g, ' - ') // tidy doubled separators
    .replace(/^\s*-\s*/, '') // strip a now-leading dash
    .trim();
}

/** Column indexes for the columns we care about (others ignored). */
interface ColumnMap {
  name: number;
  id: number;
  createdAt: number;
  lineitemName: number;
  lineitemQty: number;
  lineitemSku: number;
}

function resolveColumns(header: string[]): ColumnMap | null {
  const idx = (label: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === label.toLowerCase());
  const map: ColumnMap = {
    name: idx('Name'),
    id: idx('Id'),
    createdAt: idx('Created at'),
    lineitemName: idx('Lineitem name'),
    lineitemQty: idx('Lineitem quantity'),
    lineitemSku: idx('Lineitem sku'),
  };
  if (map.name < 0 || map.lineitemName < 0 || map.lineitemQty < 0) return null;
  return map;
}

/**
 * Parse a Shopify orders CSV into orders grouped by "Name". The numeric "Id"
 * is captured from each order's first row that carries one.
 */
export function parseFunkCsv(text: string): { orders: CsvOrder[]; error?: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { orders: [], error: 'CSV has no data rows.' };
  const cols = resolveColumns(rows[0]);
  if (!cols) {
    return {
      orders: [],
      error: 'CSV missing required columns (Name, Lineitem name, Lineitem quantity).',
    };
  }

  const byName = new Map<string, CsvOrder>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[cols.name] ?? '').trim();
    if (!name) continue; // every order line carries Name; skip stray rows
    const rawItemName = (row[cols.lineitemName] ?? '').trim();
    const sku = cols.lineitemSku >= 0 ? (row[cols.lineitemSku] ?? '').trim() : '';
    const qty = parseInt((row[cols.lineitemQty] ?? '').trim(), 10);
    const shopifyId = cols.id >= 0 ? (row[cols.id] ?? '').trim() : '';
    const createdAt = cols.createdAt >= 0 ? (row[cols.createdAt] ?? '').trim() : '';

    let order = byName.get(name);
    if (!order) {
      order = { name, shopifyId, createdAt, lineItems: [] };
      byName.set(name, order);
    }
    // Capture Id / Created at from the first row of the order that carries them.
    if (!order.shopifyId && shopifyId) order.shopifyId = shopifyId;
    if (!order.createdAt && createdAt) order.createdAt = createdAt;

    if (!rawItemName) continue; // not a line-item row
    const isDrop = isDropName(rawItemName);
    order.lineItems.push({
      rawName: rawItemName,
      cleanedName: cleanSubscriptionName(rawItemName),
      sku,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      isDrop,
      dropCans: isDrop ? parseDropCans(rawItemName) : null,
    });
  }
  return { orders: Array.from(byName.values()) };
}

// ---------------------------------------------------------------------------
// Bag-size parsing (for placeholder variants)
// ---------------------------------------------------------------------------

export interface ParsedBagSize {
  variant: PackagingVariant | null;
  grams: number;
}

const GRAMS_BY_VARIANT: Record<PackagingVariant, number> = {
  RETAIL_250G: 250,
  RETAIL_300G: 300,
  RETAIL_340G: 340,
  RETAIL_454G: 454,
  CROWLER_200G: 200,
  CROWLER_250G: 250,
  CAN_125G: 125,
  BULK_2LB: 907,
  BULK_1KG: 1000,
  BULK_5LB: 2268,
  BULK_2KG: 2000,
};

/** Best-effort bag-size parse from a line name; generic 250g fallback. */
export function parseBagSize(name: string): ParsedBagSize {
  const n = name.toLowerCase();
  const v = (variant: PackagingVariant): ParsedBagSize => ({
    variant,
    grams: GRAMS_BY_VARIANT[variant],
  });
  if (/\b5\s?lb\b/.test(n)) return v('BULK_5LB');
  if (/\b2\s?lb\b/.test(n)) return v('BULK_2LB');
  if (/\b1\s?lb\b|\b16\s?oz\b|454\s?g/.test(n)) return v('RETAIL_454G');
  if (/\b2\s?kg\b/.test(n)) return v('BULK_2KG');
  if (/\b1\s?kg\b/.test(n)) return v('BULK_1KG');
  if (/12\s?oz|340\s?g/.test(n)) return v('RETAIL_340G');
  if (/300\s?g/.test(n)) return v('RETAIL_300G');
  if (/250\s?g/.test(n)) return v('RETAIL_250G');
  if (/200\s?g/.test(n)) return v('CROWLER_200G');
  if (/125\s?g/.test(n)) return v('CAN_125G');
  return { variant: null, grams: 250 }; // generic
}

// ---------------------------------------------------------------------------
// Product matching
// ---------------------------------------------------------------------------

export interface ProductLite {
  id: string;
  product_name: string;
  sku: string | null;
  is_placeholder: boolean | null;
  packaging_variant: PackagingVariant | null;
  bag_size_g: number | null;
  internal_packaging_notes: string | null;
}

export interface MappingLite {
  csv_sku: string | null;
  csv_product_name: string | null;
  product_id: string;
}

export type MatchKind = 'matched' | 'needs_confirmation' | 'unmatched';

export interface MatchResult {
  kind: MatchKind;
  productId: string | null;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Whitelist of qualifiers we strip when fuzzy-matching product names. Anything
 * outside this list is left alone so we don't accidentally collapse two
 * genuinely different products.
 */
const QUALIFIER_WHITELIST = [
  'wholesale - case',
  'wholesale-case',
  'wholesale case',
  'wholesale',
  'subscription',
  'sub',
  'retail',
];

/**
 * Normalize a product name for fuzzy comparison:
 *  - lowercase, collapse whitespace
 *  - strip parenthetical qualifiers that match the whitelist
 *  - normalize bag-size tokens ("5 LB"/"5lb"/"5 lb bag" -> "5lb", "1 kg" -> "1kg")
 * Grind tokens ("/ ground", "/ whole beans") are intentionally NOT collapsed —
 * grind variants stay distinct until the grind-management feature ships.
 */
export function fuzzyNormalizeName(name: string): string {
  let s = (name ?? '').toLowerCase();
  // Strip whitelisted parentheticals: "(Wholesale)", "(wholesale - case)", etc.
  s = s.replace(/\(([^()]*)\)/g, (_, inner) => {
    const v = inner.trim().toLowerCase();
    return QUALIFIER_WHITELIST.includes(v) ? ' ' : `(${inner})`;
  });
  // Normalize bag sizes: "5 LB", "5lb", "5 lb bag" -> "5lb"; "1 kg" -> "1kg".
  s = s.replace(/\b(\d+)\s?lb\b(?:\s*bag)?/g, '$1lb');
  s = s.replace(/\b(\d+)\s?kg\b/g, '$1kg');
  s = s.replace(/\b(\d+)\s?g\b/g, '$1g');
  // Tidy: collapse whitespace and dangling separators.
  s = s.replace(/\s+-\s+-\s+/g, ' - ').replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Match one cleaned line against saved mappings then products.
 *  1. Saved mapping (by sku when present, else by cleaned name) -> matched.
 *  2. Auto-guess: exact sku or exact name against products -> needs_confirmation.
 *  3. Fuzzy auto-guess (whitelist qualifiers stripped, bag-size normalized) -> needs_confirmation.
 *  4. Else unmatched.
 * A mapping/guess pointing at a placeholder product is never treated as final.
 */
export function matchLineItem(
  sku: string,
  cleanedName: string,
  products: ProductLite[],
  mappings: MappingLite[],
): MatchResult {
  const realById = new Map(products.filter((p) => !p.is_placeholder).map((p) => [p.id, p]));
  const hasSku = sku.trim() !== '';

  // 1. Saved mapping.
  const mapping = hasSku
    ? mappings.find((m) => norm(m.csv_sku) === norm(sku))
    : mappings.find((m) => norm(m.csv_product_name) === norm(cleanedName));
  if (mapping && realById.has(mapping.product_id)) {
    return { kind: 'matched', productId: mapping.product_id };
  }

  // 2. Auto-guess against real products (never final).
  if (hasSku) {
    const bySku = products.find((p) => !p.is_placeholder && norm(p.sku) === norm(sku));
    if (bySku) return { kind: 'needs_confirmation', productId: bySku.id };
  }
  const byName = products.find((p) => !p.is_placeholder && norm(p.product_name) === norm(cleanedName));
  if (byName) return { kind: 'needs_confirmation', productId: byName.id };

  // 3. Fuzzy auto-guess: whitelist qualifiers stripped + bag-size normalized.
  const fuzz = fuzzyNormalizeName(cleanedName);
  if (fuzz) {
    const byFuzzy = products.find(
      (p) => !p.is_placeholder && fuzzyNormalizeName(p.product_name) === fuzz,
    );
    if (byFuzzy) return { kind: 'needs_confirmation', productId: byFuzzy.id };
  }

  // 4. Unmatched.
  return { kind: 'unmatched', productId: null };
}

// ---------------------------------------------------------------------------
// Grind variant detection (Phase 1 — count only)
// ---------------------------------------------------------------------------

/**
 * True when a line name explicitly calls out a non-whole-bean grind, e.g.
 * "... / Ground", "... / Espresso", "... / Filter". Whole-bean lines return
 * false. Used to surface a hard-to-miss banner so the operator double-checks
 * grind handling before confirming the import.
 */
export function isGrindVariantName(name: string): boolean {
  const n = (name ?? '').toLowerCase();
  // Shopify variant grinds always live after a "/" separator, e.g.
  // "Sunday Morning - 2LB bag / Ground". Only inspect the text after the
  // LAST slash so words like "Filter" or "Drip" in the product name itself
  // don't trigger a false positive.
  const slash = n.lastIndexOf('/');
  if (slash < 0) return false;
  const variant = n.slice(slash + 1).trim();
  if (!variant) return false;
  if (/\bwhole\s*beans?\b/.test(variant)) return false;
  return /\b(ground|grind|espresso|filter|drip|french\s*press|aeropress|moka|pour[-\s]?over)\b/.test(variant);
}

/** Count CSV line items across all orders that look like a grind variant. */
export function countGrindVariantLines(orders: CsvOrder[]): number {
  let n = 0;
  for (const o of orders) {
    for (const li of o.lineItems) {
      if (!li.isDrop && isGrindVariantName(li.rawName)) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Placeholder naming
// ---------------------------------------------------------------------------

const NUMBER_WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
];

/** "Placeholder One (1)", "Placeholder Two (2)", ... numeric word past 20. */
export function placeholderName(seq: number): string {
  const word = NUMBER_WORDS[seq] ?? String(seq);
  return `Placeholder ${word} (${seq})`;
}

/** Next sequence number, continuing past any existing placeholder products. */
export function nextPlaceholderSeq(existing: ProductLite[]): number {
  let max = 0;
  for (const p of existing) {
    if (!p.is_placeholder) continue;
    const m = /\((\d+)\)\s*$/.exec(p.product_name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Order classification + review grouping
// ---------------------------------------------------------------------------

export interface ContributingRow {
  orderName: string;
  rawName: string;
  cleanedName: string;
  quantity: number;
}

/** A group of identical CSV lines that resolve to one product/placeholder. */
export interface ReviewGroup {
  /** Stable key: csv sku when present, else cleaned name. */
  key: string;
  csvSku: string;
  cleanedName: string;
  /** Representative raw name (for the placeholder note + display). */
  rawName: string;
  totalQuantity: number;
  rows: ContributingRow[];
  match: MatchResult;
}

export interface OrderRef {
  name: string;
  shopifyId: string;
}

/** Per-DROP-box-line can expansion into the two 250g slots. */
export interface SlotTotals {
  slot1: number;
  slot2: number;
  ok: boolean; // false when any DROP line is unparseable / not evenly splittable
}

/**
 * Expand the DROP lines of an order into per-slot can totals.
 * A box of N cans -> N/2 to slot 1 and N/2 to slot 2 (2-can => 1+1, 4-can => 2+2),
 * multiplied by the line quantity. Odd / unparseable counts mark `ok = false`.
 */
export function sumSlotCans(dropLines: CsvLineItem[]): SlotTotals {
  let slot1 = 0;
  let slot2 = 0;
  for (const d of dropLines) {
    if (d.dropCans == null) return { slot1: 0, slot2: 0, ok: false };
    const each = d.dropCans / 2;
    if (!Number.isInteger(each) || each <= 0) return { slot1: 0, slot2: 0, ok: false };
    slot1 += each * d.quantity;
    slot2 += each * d.quantity;
  }
  return { slot1, slot2, ok: true };
}

/** Parse the order's Shopify "Created at" into a calendar date. */
export function parseOrderDate(createdAt: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt.trim());
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  const d = new Date(createdAt);
  if (!Number.isNaN(d.getTime())) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  return null;
}

/** Auto-routed DROP order folded into a month's batch (no non-DROP lines). */
export interface BatchClass {
  order: CsvOrder;
  year: number;
  month: number;
  slot1Cans: number;
  slot2Cans: number;
  /** Non-DROP lines riding along (only set for held mixed orders). */
  heldLines: CsvLineItem[];
}

export type DecisionReason = 'mixed' | 'unparseable' | 'no_date';

/** A mixed / unparseable order the user must explicitly route. */
export interface DecisionClass {
  order: CsvOrder;
  reason: DecisionReason;
  year: number | null;
  month: number | null;
  day: number | null;
  /** True when, if held for the batch, the DROP lines can be expanded. */
  canExpand: boolean;
  slot1Cans: number;
  slot2Cans: number;
  dropLines: CsvLineItem[];
  nonDropLines: CsvLineItem[];
}

export interface Classification {
  /** Orders whose lines all flow to the ship-now bundle (auto). */
  shipNowOrders: CsvOrder[];
  /** Pure-DROP orders dated <= 14th, auto-folded into their month's batch. */
  batchOrders: BatchClass[];
  /** Mixed / unparseable / dateless orders awaiting a user decision. */
  decisionOrders: DecisionClass[];
}

/**
 * Hard-date routing (Build 2). Per order, by the order's own Shopify date:
 *  - no DROP line                         -> ship-now.
 *  - mixed (DROP + non-DROP)              -> NEEDS A DECISION.
 *  - pure DROP, unparseable cans          -> NEEDS A DECISION.
 *  - pure DROP, no/invalid date           -> NEEDS A DECISION.
 *  - pure DROP, day <= 14                 -> this month's DROP batch (expanded).
 *  - pure DROP, day >= 15                 -> ship-now one-off (folds as retail).
 * Pure calendar rule — never checks whether a batch has physically shipped.
 */
export function classifyOrders(newOrders: CsvOrder[]): Classification {
  const shipNowOrders: CsvOrder[] = [];
  const batchOrders: BatchClass[] = [];
  const decisionOrders: DecisionClass[] = [];

  for (const order of newOrders) {
    const dropLines = order.lineItems.filter((li) => li.isDrop);
    if (dropLines.length === 0) {
      shipNowOrders.push(order);
      continue;
    }
    const nonDropLines = order.lineItems.filter((li) => !li.isDrop);
    const mixed = nonDropLines.length > 0;
    const date = parseOrderDate(order.createdAt);
    const slots = sumSlotCans(dropLines);
    const canExpand = slots.ok && date != null;

    const toDecision = (reason: DecisionReason) =>
      decisionOrders.push({
        order,
        reason,
        year: date?.year ?? null,
        month: date?.month ?? null,
        day: date?.day ?? null,
        canExpand,
        slot1Cans: slots.slot1,
        slot2Cans: slots.slot2,
        dropLines,
        nonDropLines,
      });

    if (mixed) {
      toDecision('mixed');
      continue;
    }
    if (!date) {
      toDecision('no_date');
      continue;
    }
    if (!slots.ok) {
      toDecision('unparseable');
      continue;
    }
    if (date.day <= 14) {
      batchOrders.push({
        order,
        year: date.year,
        month: date.month,
        slot1Cans: slots.slot1,
        slot2Cans: slots.slot2,
        heldLines: [],
      });
    } else {
      shipNowOrders.push(order); // folds into the normal bundle as a retail line
    }
  }

  return { shipNowOrders, batchOrders, decisionOrders };
}

/**
 * Group every line item of the given orders into ship-now ReviewGroups
 * (Build 1 grouping + product matching). DROP-box lines that reach here are
 * treated as ordinary retail lines.
 */
export function buildShipNowGroups(
  orders: CsvOrder[],
  products: ProductLite[],
  mappings: MappingLite[],
): ReviewGroup[] {
  const groupMap = new Map<string, ReviewGroup>();
  for (const order of orders) {
    for (const li of order.lineItems) {
      const key = li.sku.trim() !== '' ? `sku:${norm(li.sku)}` : `name:${norm(li.cleanedName)}`;
      let g = groupMap.get(key);
      if (!g) {
        g = {
          key,
          csvSku: li.sku.trim(),
          cleanedName: li.cleanedName,
          rawName: li.rawName,
          totalQuantity: 0,
          rows: [],
          match: matchLineItem(li.sku, li.cleanedName, products, mappings),
        };
        groupMap.set(key, g);
      }
      g.totalQuantity += li.quantity;
      g.rows.push({
        orderName: order.name,
        rawName: li.rawName,
        cleanedName: li.cleanedName,
        quantity: li.quantity,
      });
    }
  }
  return Array.from(groupMap.values());
}

// ---------------------------------------------------------------------------
// DROP batch month aggregation + slot/ship-date helpers
// ---------------------------------------------------------------------------

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

export interface BatchMonth {
  year: number;
  month: number;
  slot1Cans: number;
  slot2Cans: number;
  /** Order names recorded against this batch (destination 'drop_batch'). */
  orderRefs: OrderRef[];
  /** Non-DROP lines from held mixed orders that ship with the batch. */
  heldLines: { orderName: string; line: CsvLineItem }[];
}

/** Aggregate auto + held batch demand into per-month slot totals. */
export function aggregateBatchMonths(batchClasses: BatchClass[]): BatchMonth[] {
  const byMonth = new Map<string, BatchMonth>();
  for (const b of batchClasses) {
    const key = monthKey(b.year, b.month);
    let m = byMonth.get(key);
    if (!m) {
      m = { year: b.year, month: b.month, slot1Cans: 0, slot2Cans: 0, orderRefs: [], heldLines: [] };
      byMonth.set(key, m);
    }
    m.slot1Cans += b.slot1Cans;
    m.slot2Cans += b.slot2Cans;
    m.orderRefs.push({ name: b.order.name, shopifyId: b.order.shopifyId });
    for (const line of b.heldLines) m.heldLines.push({ orderName: b.order.name, line });
  }
  return Array.from(byMonth.values()).sort((a, b) => monthKey(a.year, a.month).localeCompare(monthKey(b.year, b.month)));
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "JUN 26" style suffix for slot product names. */
export function monthShortYY(year: number, month: number): string {
  return `${MONTHS_SHORT[month - 1]} ${String(year % 100).padStart(2, '0')}`;
}

/** Slot product display name, e.g. "FUNK SUB ONE (1) - JUN 26". */
export function slotProductName(slot: 1 | 2, year: number, month: number): string {
  const word = slot === 1 ? 'ONE (1)' : 'TWO (2)';
  return `FUNK SUB ${word} - ${monthShortYY(year, month)}`;
}

/**
 * Ship date for a month's standing DROP order: the 15th, rolled back to the
 * preceding Friday when the 15th lands on a weekend. Real calendar math.
 */
export function dropShipDate(year: number, month: number): { year: number; month: number; day: number } {
  const dow = new Date(year, month - 1, 15).getDay();
  let day = 15;
  if (dow === 6) day = 14; // Saturday -> Friday
  else if (dow === 0) day = 13; // Sunday -> Friday
  return { year, month, day };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD stamp for a {year,month,day}. */
export function dateStamp(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/** Noon (local) of a {year,month,day} as an ISO string — used for work_deadline_at. */
export function noonIso(d: { year: number; month: number; day: number }): string {
  return new Date(d.year, d.month - 1, d.day, 12, 0, 0).toISOString();
}

/** Standing DROP order reference, e.g. "FUNK-DROP-2026-06". */
export function dropBatchReference(year: number, month: number): string {
  return `FUNK-DROP-${year}-${pad2(month)}`;
}

// ---------------------------------------------------------------------------
// Reference + work-deadline helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD in local time. */
export function todayStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Base reference "FUNK-CSV-YYYY-MM-DD" (suffix added when one exists today). */
export function funkReferenceBase(d = new Date()): string {
  return `FUNK-CSV-${todayStamp(d)}`;
}

/** End of next business day at 17:00 local, as a `datetime-local` value. */
export function nextBusinessDayDeadline(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(17, 0, 0, 0);
  // Format as YYYY-MM-DDTHH:mm for an <input type="datetime-local">.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
