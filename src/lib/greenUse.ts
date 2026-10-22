/**
 * Green coffee used by roasting — pure maths, mirrored in the database
 * (public.green_kg_for_roasted, used by mark_batch_roasted).
 *
 * Roasting loses weight, so a batch uses more green than it yields:
 *   green kg = roasted kg ÷ (1 − roast loss % / 100)
 * e.g. 20 kg roasted at 15% loss uses 23.53 kg of green.
 */
import type { RoastGroupBasketLots } from '@/hooks/roastGroupBasketLots';

/** kg of green per kg of roasted output. Out-of-range loss % → 1 (no adjustment). */
export function greenFactor(lossPct: number | null | undefined): number {
  const l = Number(lossPct);
  if (!Number.isFinite(l) || l < 0 || l >= 100) return 1;
  return 1 / (1 - l / 100);
}

export function greenKgForRoasted(roastedKg: number, lossPct: number | null | undefined): number {
  return (Number(roastedKg) || 0) * greenFactor(lossPct);
}

export interface LotSplit {
  lot_id: string;
  lot_number: string;
  /** Share of the batch's green, 0..100. */
  pct: number;
  /** Basket the lot comes through, if any. */
  via_basket?: string | null;
}

interface LinkSource {
  lot_id: string;
  lot_number: string;
  pct_of_lot: number | null;
}

/**
 * Default split of a batch's green across the roast group's lots:
 *   - each source (linked lot or basket) weighted by its %, or equally when no % is set
 *     (same rule as the green value for pricing);
 *   - a basket's share is split across its active lots by their active %.
 * Result adds up to 100 (or is empty when there's nothing to take from).
 */
export function defaultLotSplits(links: LinkSource[], baskets: RoastGroupBasketLots[]): LotSplit[] {
  type Src = { pct: number | null; lots: { lot_id: string; lot_number: string; share: number; via?: string }[] };
  const sources: Src[] = [];
  for (const l of links) {
    sources.push({ pct: l.pct_of_lot, lots: [{ lot_id: l.lot_id, lot_number: l.lot_number, share: 1 }] });
  }
  for (const b of baskets) {
    if (b.active.length === 0) continue;
    const total = b.active.reduce((a, x) => a + Math.max(0, x.activePct), 0);
    sources.push({
      pct: b.rgPct,
      lots: b.active.map(x => ({
        lot_id: x.lot.id,
        lot_number: x.lot.lot_number,
        share: total > 0 ? Math.max(0, x.activePct) / total : 1 / b.active.length,
        via: b.basket.name,
      })),
    });
  }
  if (sources.length === 0) return [];

  const anyPct = sources.some(s => s.pct != null && Number(s.pct) > 0);
  const weightOf = (s: Src) => (anyPct ? Math.max(0, Number(s.pct) || 0) : 1);
  const totalWeight = sources.reduce((a, s) => a + weightOf(s), 0);
  if (totalWeight <= 0) return [];

  const byLot = new Map<string, LotSplit>();
  for (const s of sources) {
    const w = weightOf(s) / totalWeight;
    for (const l of s.lots) {
      const pct = 100 * w * l.share;
      if (pct <= 0) continue;
      const prev = byLot.get(l.lot_id);
      if (prev) prev.pct += pct;
      else byLot.set(l.lot_id, { lot_id: l.lot_id, lot_number: l.lot_number, pct, via_basket: l.via ?? null });
    }
  }
  return [...byLot.values()].sort((a, b) => b.pct - a.pct);
}

/** kg per lot for a batch, from a split (normalised, like the database does). */
export function splitKg(splits: Pick<LotSplit, 'lot_id' | 'pct'>[], greenKg: number): Map<string, number> {
  const total = splits.reduce((a, s) => a + Math.max(0, s.pct), 0);
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const s of splits) if (s.pct > 0) out.set(s.lot_id, (greenKg * s.pct) / total);
  return out;
}
