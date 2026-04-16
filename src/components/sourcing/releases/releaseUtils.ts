// Shared helpers for the Releases module.
export const KG_PER_LB = 2.20462;

export type Currency = 'CAD' | 'USD';

export interface SharedCostLine {
  amount: number;
  currency: Currency;
}

export interface SharedCostsJson {
  carry?: SharedCostLine;
  freight?: SharedCostLine;
  duties?: SharedCostLine;
  fees?: SharedCostLine;
  other?: SharedCostLine;
}

export const SHARED_COST_KEYS = ['carry', 'freight', 'duties', 'fees', 'other'] as const;
export type SharedCostKey = typeof SHARED_COST_KEYS[number];

export const SHARED_COST_LABELS: Record<SharedCostKey, string> = {
  carry: 'Carry / Storage',
  freight: 'Freight',
  duties: 'Customs / Duties / Taxes',
  fees: 'Fees',
  other: 'Other',
};

export function emptySharedCosts(currency: Currency = 'USD'): SharedCostsJson {
  return {
    carry: { amount: 0, currency },
    freight: { amount: 0, currency },
    duties: { amount: 0, currency },
    fees: { amount: 0, currency },
    other: { amount: 0, currency },
  };
}

/**
 * Convert a shared-cost amount to USD for a unified prorated total.
 * If currency is CAD and no fxRate is provided, the value is treated as already in USD
 * (best-effort fallback so we never silently drop costs).
 */
export function sharedCostToUsd(line: SharedCostLine | undefined, fxRate: number | null): number {
  if (!line) return 0;
  const amt = Number(line.amount) || 0;
  if (line.currency === 'USD') return amt;
  if (fxRate && fxRate > 0) return amt / fxRate;
  return amt;
}

export function totalSharedCostsUsd(sc: SharedCostsJson, fxRate: number | null = null): number {
  return SHARED_COST_KEYS.reduce((sum, k) => sum + sharedCostToUsd(sc[k], fxRate), 0);
}

/**
 * Per-kg shared cost share for a line, prorated by the line's weight relative to total weight.
 * Returns USD/kg.
 */
export function sharedCostShareUsdPerKg(
  lineKg: number,
  totalKg: number,
  totalSharedUsd: number,
): number {
  if (totalKg <= 0 || lineKg <= 0) return 0;
  // weighted average prorated by kg = totalShared * (lineKg/totalKg) / lineKg = totalShared / totalKg
  return totalSharedUsd / totalKg;
}

export function priceUsdPerLbToUsdPerKg(pricePerLbUsd: number | null | undefined): number {
  if (!pricePerLbUsd) return 0;
  return pricePerLbUsd * KG_PER_LB;
}

export function bookValuePerKgUsd(
  pricePerLbUsd: number | null | undefined,
  sharedShareUsdPerKg: number,
): number {
  return priceUsdPerLbToUsdPerKg(pricePerLbUsd) + sharedShareUsdPerKg;
}

export function bookValuePerLbUsd(
  pricePerLbUsd: number | null | undefined,
  sharedShareUsdPerKg: number,
): number {
  return bookValuePerKgUsd(pricePerLbUsd, sharedShareUsdPerKg) / KG_PER_LB;
}

export function statusBadgeClass(status: string): string {
  if (status === 'INVOICED') return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30';
  return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
}
