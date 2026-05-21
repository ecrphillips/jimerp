/**
 * Unit Economics calculator — pure helpers.
 * All money values are CAD. Weights are converted internally to grams for math.
 * Currency arithmetic uses decimal.js to avoid float drift.
 */
import Decimal from 'decimal.js';
import { TIER_RATES } from '@/components/bookings/bookingUtils';

const D = (v: Decimal.Value | null | undefined, fb = 0): Decimal => {
  try {
    const d = new Decimal((v ?? fb) as Decimal.Value);
    return d.isFinite() ? d : new Decimal(fb);
  } catch {
    return new Decimal(fb);
  }
};

export type DisplayUnit = 'BAG' | 'KG' | 'LB';
export type GreenPriceUnit = 'KG' | 'LB';
export type CoroastTier = 'MEMBER' | 'GROWTH' | 'PRODUCTION';

export const ROASTER_THROUGHPUT_KG_PER_HR = 40;
export const KG_PER_LB = 0.45359237;
export const G_PER_KG = 1000;

export interface UnitEconomicsInputs {
  // Display
  displayUnit: DisplayUnit;
  bagSizeG: number;

  // Green
  greenPriceUnit: GreenPriceUnit;
  greenPrice: number | null;        // $/kg or $/lb depending on greenPriceUnit
  yieldLossPct: number;             // 0–100

  // Packaging
  packagingPerBag: number | null;

  // Roasting (member uses tier from account)
  tier: CoroastTier | null;         // null when account has no tier
  forecastOverage: boolean;         // if true, also show overage rate

  // Labour
  includeLabour: boolean;
  labourHoursPerBatch: number;
  labourRatePerHr: number;
  batchSizeKg: number;              // how much roasted per batch (default 40 — one hour)

  // Overhead
  overheadMonthly: number | null;

  // Volume (kg roasted per month)
  monthlyKg: number | null;

  // Pricing per chosen displayUnit
  wholesalePrice: number | null;
  retailPrice: number | null;

  // Channel split
  wholesalePct: number;             // 0–100
}

export const DEFAULT_INPUTS: UnitEconomicsInputs = {
  displayUnit: 'BAG',
  bagSizeG: 340,
  greenPriceUnit: 'LB',
  greenPrice: null,
  yieldLossPct: 15,
  packagingPerBag: null,
  tier: null,
  forecastOverage: false,
  includeLabour: false,
  labourHoursPerBatch: 0,
  labourRatePerHr: 25,
  batchSizeKg: 40,
  overheadMonthly: null,
  monthlyKg: null,
  wholesalePrice: null,
  retailPrice: null,
  wholesalePct: 50,
};

/** Grams of roasted coffee per "unit" the user is viewing. */
export function gramsPerUnit(i: UnitEconomicsInputs): number {
  switch (i.displayUnit) {
    case 'BAG': return Math.max(1, i.bagSizeG || 340);
    case 'KG':  return G_PER_KG;
    case 'LB':  return G_PER_KG * KG_PER_LB;
  }
}

/** Convert green price to $/kg green regardless of which unit the user typed. */
export function greenPricePerKg(i: UnitEconomicsInputs): number {
  if (i.greenPrice == null) return 0;
  return i.greenPriceUnit === 'KG' ? i.greenPrice : D(i.greenPrice).div(KG_PER_LB).toNumber();
}

/**
 * Roasted coffee yield: 1 kg green → (1 - loss) kg roasted.
 * So 1 kg roasted requires 1 / (1 - loss) kg green.
 */
export function greenKgPerRoastedKg(i: UnitEconomicsInputs): number {
  const loss = Math.min(0.99, Math.max(0, (i.yieldLossPct || 0) / 100));
  return 1 / (1 - loss);
}

/** Effective roasting $/kg from tier (within included hours). */
export function roastingCostPerKg(tier: CoroastTier | null): number {
  if (!tier) return 0;
  const t = TIER_RATES[tier];
  if (!t) return 0;
  const perHour = D(t.base).div(Math.max(1, t.includedHours));
  return perHour.div(ROASTER_THROUGHPUT_KG_PER_HR).toNumber();
}

/** Overage roasting $/kg (when over included hours). */
export function roastingOveragePerKg(tier: CoroastTier | null): number {
  if (!tier) return 0;
  const t = TIER_RATES[tier];
  if (!t) return 0;
  return D(t.overageRate).div(ROASTER_THROUGHPUT_KG_PER_HR).toNumber();
}

export interface CostBreakdown {
  green: number;
  packaging: number;
  roasting: number;
  labour: number;
  overhead: number;
  total: number;
}

/** All costs per user-selected unit (bag, kg, or lb of roasted coffee). */
export function costPerUnit(i: UnitEconomicsInputs): CostBreakdown {
  const gPerUnit = gramsPerUnit(i);
  const kgRoastedPerUnit = D(gPerUnit).div(G_PER_KG);

  // Green: yield-loss adjusted
  const greenKgNeeded = kgRoastedPerUnit.times(greenKgPerRoastedKg(i));
  const green = greenKgNeeded.times(greenPricePerKg(i));

  // Packaging: only applies when the unit IS a bag
  const packaging = i.displayUnit === 'BAG' ? D(i.packagingPerBag) : new Decimal(0);

  // Roasting (use overage rate if user flagged forecast overage)
  const roastRate = i.forecastOverage
    ? roastingOveragePerKg(i.tier)
    : roastingCostPerKg(i.tier);
  const roasting = kgRoastedPerUnit.times(roastRate);

  // Labour
  let labour = new Decimal(0);
  if (i.includeLabour && i.labourHoursPerBatch > 0 && i.batchSizeKg > 0) {
    const labourPerKg = D(i.labourHoursPerBatch).times(i.labourRatePerHr).div(i.batchSizeKg);
    labour = kgRoastedPerUnit.times(labourPerKg);
  }

  // Overhead allocated per unit based on monthly volume
  let overhead = new Decimal(0);
  if (i.overheadMonthly && i.overheadMonthly > 0 && i.monthlyKg && i.monthlyKg > 0) {
    const overheadPerKg = D(i.overheadMonthly).div(i.monthlyKg);
    overhead = kgRoastedPerUnit.times(overheadPerKg);
  }

  const total = green.plus(packaging).plus(roasting).plus(labour).plus(overhead);
  return {
    green: green.toNumber(),
    packaging: packaging.toNumber(),
    roasting: roasting.toNumber(),
    labour: labour.toNumber(),
    overhead: overhead.toNumber(),
    total: total.toNumber(),
  };
}

export interface MarginRow {
  price: number;
  cost: number;
  margin: number;
  marginPct: number;
}

export function marginAt(price: number | null, cost: number): MarginRow {
  const p = D(price);
  const c = D(cost);
  const m = p.minus(c);
  const marginPct = p.gt(0) ? m.div(p).times(100) : new Decimal(0);
  return {
    price: p.toNumber(),
    cost: c.toNumber(),
    margin: m.toNumber(),
    marginPct: marginPct.toNumber(),
  };
}

export interface MonthlyView {
  unitsPerMonth: number;
  productionCost: number;
  revenue: number;
  grossProfit: number;
  breakEvenUnits: number | null;
}

export function monthlyView(i: UnitEconomicsInputs, perUnit: CostBreakdown): MonthlyView {
  const gPerUnit = gramsPerUnit(i);
  const monthlyG = D(i.monthlyKg).times(G_PER_KG);
  const unitsPerMonth = gPerUnit > 0 ? monthlyG.div(gPerUnit) : new Decimal(0);

  // Variable cost per unit excludes overhead (which is fixed monthly)
  const variablePerUnit = D(perUnit.green).plus(perUnit.packaging).plus(perUnit.roasting).plus(perUnit.labour);
  const fixedMonthly = D(i.overheadMonthly);

  const productionCost = unitsPerMonth.times(variablePerUnit).plus(fixedMonthly);

  const wsPct = D(Math.min(100, Math.max(0, i.wholesalePct))).div(100);
  const blendedPrice = D(i.wholesalePrice).times(wsPct)
    .plus(D(i.retailPrice).times(new Decimal(1).minus(wsPct)));

  const revenue = unitsPerMonth.times(blendedPrice);
  const grossProfit = revenue.minus(productionCost);

  let breakEvenUnits: number | null = null;
  const contribution = blendedPrice.minus(variablePerUnit);
  if (contribution.gt(0) && fixedMonthly.gt(0)) {
    breakEvenUnits = fixedMonthly.div(contribution).toNumber();
  } else if (fixedMonthly.eq(0) && blendedPrice.gt(variablePerUnit)) {
    breakEvenUnits = 0;
  }

  return {
    unitsPerMonth: unitsPerMonth.toNumber(),
    productionCost: productionCost.toNumber(),
    revenue: revenue.toNumber(),
    grossProfit: grossProfit.toNumber(),
    breakEvenUnits,
  };
}

export function unitLabel(u: DisplayUnit): string {
  return u === 'BAG' ? 'bag' : u === 'KG' ? 'kg' : 'lb';
}

export function unitLabelPlural(u: DisplayUnit): string {
  return u === 'BAG' ? 'bags' : u === 'KG' ? 'kg' : 'lb';
}
