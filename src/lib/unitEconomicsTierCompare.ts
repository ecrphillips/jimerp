/**
 * Tier comparison helpers for the co-roasting My Numbers page.
 * Delegates all per-unit math to the existing engine in unitEconomics.ts.
 * Adds a realistic monthly roast-bill model (base + overage past included hours)
 * for tier-crossover analysis — the engine's costPerUnit uses a single flat rate.
 */
import { TIER_RATES } from '@/components/bookings/bookingUtils';
import {
  type UnitEconomicsInputs,
  type CostBreakdown,
  type CoroastTier,
  ROASTER_THROUGHPUT_KG_PER_HR,
  costPerUnit,
} from '@/lib/unitEconomics';

export const TIER_ORDER: CoroastTier[] = ['MEMBER', 'GROWTH', 'PRODUCTION'];

/** Solve the kg/mo at which `upper` tier's monthly bill equals `lower`'s. */
function crossoverKg(lower: CoroastTier, upper: CoroastTier): number | null {
  const lo = TIER_RATES[lower];
  const hi = TIER_RATES[upper];
  if (!lo || !hi) return null;
  const T = ROASTER_THROUGHPUT_KG_PER_HR;
  const incLoKg = lo.includedHours * T;
  const incHiKg = hi.includedHours * T;

  // Case A: lower overaging, upper still within included.
  if (lo.overageRate > 0) {
    const hours = lo.includedHours + (hi.base - lo.base) / lo.overageRate;
    const kg = hours * T;
    if (kg >= incLoKg && kg <= incHiKg) return kg;
  }
  // Case B: both overaging.
  if (lo.overageRate !== hi.overageRate) {
    const num =
      (hi.base - lo.base) -
      hi.includedHours * hi.overageRate +
      lo.includedHours * lo.overageRate;
    const denom = lo.overageRate - hi.overageRate;
    const hours = num / denom;
    const kg = hours * T;
    if (kg >= incHiKg && kg > 0 && Number.isFinite(kg)) return kg;
  }
  return null;
}

export interface TierRange {
  minKg: number;
  maxKg: number | null;
}

let _staticRanges: Record<CoroastTier, TierRange> | null = null;
/**
 * Static kg/mo range where each tier is the cheapest option.
 * Depends only on TIER_RATES — computed once and cached.
 */
export function computeStaticTierRanges(): Record<CoroastTier, TierRange> {
  if (_staticRanges) return _staticRanges;
  const memberToGrowth = crossoverKg('MEMBER', 'GROWTH');
  const growthToProduction = crossoverKg('GROWTH', 'PRODUCTION');
  _staticRanges = {
    MEMBER: { minKg: 0, maxKg: memberToGrowth },
    GROWTH: { minKg: memberToGrowth ?? 0, maxKg: growthToProduction },
    PRODUCTION: { minKg: growthToProduction ?? 0, maxKg: null },
  };
  return _staticRanges;
}

export interface TierCostSummary {
  tier: CoroastTier;
  perUnit: CostBreakdown;
}

/** Per-unit cost at every tier, using the user's other inputs unchanged. */
export function computeCostAtAllTiers(
  inputs: UnitEconomicsInputs,
): Record<CoroastTier, TierCostSummary> {
  const out = {} as Record<CoroastTier, TierCostSummary>;
  for (const tier of TIER_ORDER) {
    out[tier] = {
      tier,
      perUnit: costPerUnit({ ...inputs, tier }),
    };
  }
  return out;
}

/**
 * Whichever tier yields the lowest TOTAL MONTHLY ROAST BILL at the user's
 * current monthlyKg. All other costs (green, packaging, labour, overhead) are
 * tier-independent, so the cheapest tier is whichever has the lowest monthly
 * roast bill — base fee + overage past included hours.
 *
 * Sanity check (TIER_RATES from bookingUtils.ts, throughput 40 kg/hr):
 *   50 kg/mo  → MEMBER 399       | GROWTH 859        | PRODUCTION 1399   → MEMBER
 *   300 kg/mo → MEMBER 1119      | GROWTH 931.50     | PRODUCTION 1399   → GROWTH
 *   1000 kg/mo→ MEMBER 3919      | GROWTH 3469       | PRODUCTION 3089   → PRODUCTION
 */
export function findCheapestTier(inputs: UnitEconomicsInputs): CoroastTier {
  const monthlyKg = inputs.monthlyKg ?? 0;
  let cheapest: CoroastTier = 'MEMBER';
  let lowestBill = monthlyRoastBill('MEMBER', monthlyKg);
  for (const tier of TIER_ORDER) {
    const bill = monthlyRoastBill(tier, monthlyKg);
    if (bill < lowestBill) {
      lowestBill = bill;
      cheapest = tier;
    }
  }
  return cheapest;
}

/** Realistic monthly roasting bill: base + overage past included hours. */
export function monthlyRoastBill(tier: CoroastTier, monthlyKg: number): number {
  const r = TIER_RATES[tier];
  if (!r) return 0;
  const hours = Math.max(0, monthlyKg) / ROASTER_THROUGHPUT_KG_PER_HR;
  if (hours <= r.includedHours) return r.base;
  return r.base + (hours - r.includedHours) * r.overageRate;
}

export interface TierSavings {
  bestTier: CoroastTier;
  monthlySavings: number;
}

/**
 * Compare monthly roast bill across all tiers at the user's current volume.
 * If a different tier is cheaper than the user's current tier, return that
 * tier and the monthly savings vs current. Returns null when the user is
 * already on the cheapest tier (or no current tier set).
 *
 * Sanity check (TIER_RATES from bookingUtils.ts, throughput 40 kg/hr):
 *   50 kg/mo, currentTier=MEMBER     → null (MEMBER is already cheapest at 399)
 *   50 kg/mo, currentTier=PRODUCTION → { bestTier: 'MEMBER', monthlySavings: 1000 }
 *                                       (1399 - 399 = 1000)
 *   600 kg/mo, currentTier=MEMBER    → { bestTier: 'PRODUCTION', monthlySavings: 530 }
 *                                       (2319 - 1789 = 530)
 *   1000 kg/mo, currentTier=PRODUCTION → null (PRODUCTION cheapest at 3089)
 */
export function findBestTierSavings(
  inputs: UnitEconomicsInputs,
  currentTier: CoroastTier | null,
): TierSavings | null {
  if (!currentTier) return null;
  const monthlyKg = inputs.monthlyKg ?? 0;
  const currentBill = monthlyRoastBill(currentTier, monthlyKg);

  let bestTier: CoroastTier = currentTier;
  let bestBill = currentBill;
  for (const tier of TIER_ORDER) {
    if (tier === currentTier) continue;
    const bill = monthlyRoastBill(tier, monthlyKg);
    if (bill < bestBill) {
      bestBill = bill;
      bestTier = tier;
    }
  }
  if (bestTier === currentTier) return null;
  return { bestTier, monthlySavings: currentBill - bestBill };
}
