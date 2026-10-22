/**
 * Green sources for a roast group — pure logic.
 *
 * A roast group takes its green from specific lots (green_lot_roast_group_links,
 * weighted by pct_of_lot) and/or baskets (roast_group_baskets, weighted by pct).
 * A basket's own value is its active lots weighted by their active %.
 *
 * Weighting rule (unchanged from the lot-only version): rows without a usable
 * value are ignored; the rest are weighted by their % ; if no % is set at all,
 * they are weighted equally.
 */

export interface PricedLot {
  id: string;
  lot_number: string;
  book_value_per_kg: number | null;
  market_value_per_kg: number | null;
}

/** Market (replacement) value; falls back to book. null when not usable. */
export function lotMarketPerKg(lot: Pick<PricedLot, 'book_value_per_kg' | 'market_value_per_kg'>): number | null {
  const v = lot.market_value_per_kg ?? lot.book_value_per_kg;
  return v != null && Number(v) > 0 ? Number(v) : null;
}

/** Landed book value; falls back to market. null when not usable. */
export function lotBookPerKg(lot: Pick<PricedLot, 'book_value_per_kg' | 'market_value_per_kg'>): number | null {
  const v = lot.book_value_per_kg ?? lot.market_value_per_kg;
  return v != null && Number(v) > 0 ? Number(v) : null;
}

interface Weighable {
  pct: number | null;
  marketPerKg: number | null;
  bookPerKg: number | null;
}

export interface WeightedResult<T> {
  marketPerKg: number | null;
  bookPerKg: number | null;
  /** Each input with the share (0..1) it got in the average; 0 when unusable. */
  lines: (T & { weight: number })[];
  usableCount: number;
}

/** Weighted average of $/kg values by %, equal weights when no % is set. */
export function weightedAverage<T extends Weighable>(items: T[]): WeightedResult<T> {
  const usable = items.filter(i => i.marketPerKg != null);
  if (usable.length === 0) {
    return { marketPerKg: null, bookPerKg: null, lines: items.map(i => ({ ...i, weight: 0 })), usableCount: 0 };
  }
  const totalPct = usable.reduce((a, i) => a + (Number(i.pct) || 0), 0);
  const equal = totalPct <= 0;
  const weightOf = (i: T) =>
    i.marketPerKg == null ? 0 : equal ? 1 / usable.length : (Number(i.pct) || 0) / totalPct;

  let market = 0;
  let book = 0;
  for (const i of usable) {
    const w = weightOf(i);
    market += w * (i.marketPerKg as number);
    book += w * (i.bookPerKg ?? (i.marketPerKg as number));
  }
  return {
    marketPerKg: market,
    bookPerKg: book,
    lines: items.map(i => ({ ...i, weight: weightOf(i) })),
    usableCount: usable.length,
  };
}

// ─── Basket value ────────────────────────────────────────────────────────

export interface BasketMemberPriced {
  active_pct: number | null;
  lot: PricedLot;
}

export interface BasketValueLine extends Weighable {
  lot: PricedLot;
}

/** A basket's value = its active lots, weighted by active %. Lined-up lots don't count. */
export function basketValue(members: BasketMemberPriced[]): WeightedResult<BasketValueLine> {
  const lines: BasketValueLine[] = members
    .filter(m => m.active_pct != null)
    .map(m => ({
      lot: m.lot,
      pct: m.active_pct,
      marketPerKg: lotMarketPerKg(m.lot),
      bookPerKg: lotBookPerKg(m.lot),
    }));
  return weightedAverage(lines);
}

// ─── Roast group value ───────────────────────────────────────────────────

export interface GreenSourceLine extends Weighable {
  kind: 'LOT' | 'BASKET';
  /** lot id or basket id */
  id: string;
  label: string;
  /** For baskets: the basket's own breakdown. */
  basketLines?: (BasketValueLine & { weight: number })[];
}

export interface LinkPriced {
  pct_of_lot: number | null;
  lot: PricedLot | null;
}

export interface RoastGroupBasketPriced {
  pct: number | null;
  basket: { id: string; name: string; members: BasketMemberPriced[] } | null;
}

/** Combine linked lots and baskets into one weighted green value. */
export function roastGroupGreenValue(links: LinkPriced[], baskets: RoastGroupBasketPriced[]): WeightedResult<GreenSourceLine> {
  const lines: GreenSourceLine[] = [];
  for (const l of links) {
    if (!l.lot) continue;
    lines.push({
      kind: 'LOT',
      id: l.lot.id,
      label: l.lot.lot_number,
      pct: l.pct_of_lot,
      marketPerKg: lotMarketPerKg(l.lot),
      bookPerKg: lotBookPerKg(l.lot),
    });
  }
  for (const b of baskets) {
    if (!b.basket) continue;
    const v = basketValue(b.basket.members);
    lines.push({
      kind: 'BASKET',
      id: b.basket.id,
      label: b.basket.name,
      pct: b.pct,
      marketPerKg: v.marketPerKg,
      bookPerKg: v.bookPerKg,
      basketLines: v.lines,
    });
  }
  return weightedAverage(lines);
}

/** Total of the % entered across a roast group's sources (lots + baskets). */
export function sourcesPctTotal(pcts: (number | null)[]): { total: number; anySet: boolean } {
  const set = pcts.filter((p): p is number => p != null);
  return { total: set.reduce((a, p) => a + Number(p), 0), anySet: set.length > 0 };
}

/** Warn when some % are entered and they don't add to 100 (0.01 tolerance). */
export function sourcesPctIsOff(pcts: (number | null)[]): boolean {
  const { total, anySet } = sourcesPctTotal(pcts);
  return anySet && Math.abs(total - 100) > 0.01;
}
