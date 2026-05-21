// Pure functions for market-pricing analytics.
// All inputs assume `price_per_g_cad` (CAD per gram) as the comparison axis.

export type Bucket = 'VALUE' | 'MID' | 'PREMIUM';

export interface BucketSummary {
  bucket: Bucket;
  count: number;
  minPpg: number;
  maxPpg: number;
}

/** Sort a numeric array ascending and strip null/NaN. */
function cleanSorted(values: ReadonlyArray<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v == null || Number.isNaN(v)) continue;
    out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Percentile rank of `value` within `values` (0..100).
 * Uses "fraction of values strictly less than value, plus half of equal values",
 * which behaves nicely on ties.
 * Returns null if `values` is empty or `value` is null.
 */
export function percentileOf(
  value: number | null | undefined,
  values: ReadonlyArray<number | null | undefined>,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const sorted = cleanSorted(values);
  if (sorted.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal / 2) / sorted.length) * 100;
}

/** Median (or any quantile q in [0,1]) via linear interpolation. */
export function quantile(values: ReadonlyArray<number | null | undefined>, q: number): number | null {
  const sorted = cleanSorted(values);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sorted[base];
  const hi = sorted[base + 1] ?? lo;
  return lo + rest * (hi - lo);
}

export function median(values: ReadonlyArray<number | null | undefined>): number | null {
  return quantile(values, 0.5);
}

/** Return [q1, q2, q3] (or nulls if not enough data). */
export function quartiles(
  values: ReadonlyArray<number | null | undefined>,
): { q1: number | null; q2: number | null; q3: number | null } {
  return {
    q1: quantile(values, 0.25),
    q2: quantile(values, 0.5),
    q3: quantile(values, 0.75),
  };
}

/**
 * Bucket a price-per-gram by quartile of the distribution:
 *   < Q1               -> VALUE
 *   [Q1, Q3)           -> MID
 *   >= Q3              -> PREMIUM
 * Returns null when distribution insufficient or value missing.
 */
export function bucketOf(
  value: number | null | undefined,
  values: ReadonlyArray<number | null | undefined>,
): Bucket | null {
  if (value == null || Number.isNaN(value)) return null;
  const { q1, q3 } = quartiles(values);
  if (q1 == null || q3 == null) return null;
  if (value < q1) return 'VALUE';
  if (value >= q3) return 'PREMIUM';
  return 'MID';
}

/** Aggregate counts + min/max per bucket for the legend chips. */
export function bucketSummaries(
  values: ReadonlyArray<number | null | undefined>,
): BucketSummary[] {
  const sorted = cleanSorted(values);
  if (sorted.length === 0) return [];
  const { q1, q3 } = quartiles(sorted);
  if (q1 == null || q3 == null) return [];

  const value: number[] = [];
  const mid: number[] = [];
  const premium: number[] = [];
  for (const v of sorted) {
    if (v < q1) value.push(v);
    else if (v >= q3) premium.push(v);
    else mid.push(v);
  }
  const range = (arr: number[]): { minPpg: number; maxPpg: number } => ({
    minPpg: arr.length ? arr[0] : 0,
    maxPpg: arr.length ? arr[arr.length - 1] : 0,
  });
  return [
    { bucket: 'VALUE', count: value.length, ...range(value) },
    { bucket: 'MID', count: mid.length, ...range(mid) },
    { bucket: 'PREMIUM', count: premium.length, ...range(premium) },
  ];

}

/**
 * Deterministic jitter in [-0.5, 0.5) from a string key. Used to scatter
 * dots horizontally on the strip plot without overlapping while staying
 * stable across renders.
 */
export function stableJitter(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // map to [0,1)
  return (((h >>> 0) % 10000) / 10000) - 0.5;
}
