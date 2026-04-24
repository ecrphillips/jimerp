/**
 * Unit Economics calculator — pure helpers.
 * All money values are CAD. Weights are converted internally to grams for math.
 */
import { TIER_RATES } from '@/components/bookings/bookingUtils';

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
  return i.greenPriceUnit === 'KG' ? i.greenPrice : i.greenPrice / KG_PER_LB;
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
  // monthly fee per included hour, then per kg at 40kg/hr
  const perHour = t.base / Math.max(1, t.includedHours);
  return perHour / ROASTER_THROUGHPUT_KG_PER_HR;
}

/** Overage roasting $/kg (when over included hours). */
export function roastingOveragePerKg(tier: CoroastTier | null): number {
  if (!tier) return 0;
  const t = TIER_RATES[tier];
  if (!t) return 0;
  return t.overageRate / ROASTER_THROUGHPUT_KG_PER_HR;
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
  const kgRoastedPerUnit = gPerUnit / G_PER_KG;

  // Green: yield-loss adjusted
  const greenKgNeeded = kgRoastedPerUnit * greenKgPerRoastedKg(i);
  const green = greenKgNeeded * greenPricePerKg(i);

  // Packaging: only applies when the unit IS a bag
  const packaging = i.displayUnit === 'BAG' ? (i.packagingPerBag ?? 0) : 0;

  // Roasting (use overage rate if user flagged forecast overage)
  const roastRate = i.forecastOverage
    ? roastingOveragePerKg(i.tier)
    : roastingCostPerKg(i.tier);
  const roasting = kgRoastedPerUnit * roastRate;

  // Labour
  let labour = 0;
  if (i.includeLabour && i.labourHoursPerBatch > 0 && i.batchSizeKg > 0) {
    const labourPerKg = (i.labourHoursPerBatch * i.labourRatePerHr) / i.batchSizeKg;
    labour = kgRoastedPerUnit * labourPerKg;
  }

  // Overhead allocated per unit based on monthly volume
  let overhead = 0;
  if (i.overheadMonthly && i.overheadMonthly > 0 && i.monthlyKg && i.monthlyKg > 0) {
    const overheadPerKg = i.overheadMonthly / i.monthlyKg;
    overhead = kgRoastedPerUnit * overheadPerKg;
  }

  const total = green + packaging + roasting + labour + overhead;
  return { green, packaging, roasting, labour, overhead, total };
}

export interface MarginRow {
  price: number;
  cost: number;
  margin: number;
  marginPct: number;
}

export function marginAt(price: number | null, cost: number): MarginRow {
  const p = price ?? 0;
  const m = p - cost;
  return {
    price: p,
    cost,
    margin: m,
    marginPct: p > 0 ? (m / p) * 100 : 0,
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
  const monthlyG = (i.monthlyKg ?? 0) * G_PER_KG;
  const unitsPerMonth = gPerUnit > 0 ? monthlyG / gPerUnit : 0;

  // Variable cost per unit excludes overhead (which is fixed monthly)
  const variablePerUnit = perUnit.green + perUnit.packaging + perUnit.roasting + perUnit.labour;
  const fixedMonthly = i.overheadMonthly ?? 0;

  const productionCost = unitsPerMonth * variablePerUnit + fixedMonthly;

  const wsPct = Math.min(100, Math.max(0, i.wholesalePct)) / 100;
  const blendedPrice =
    (i.wholesalePrice ?? 0) * wsPct +
    (i.retailPrice ?? 0) * (1 - wsPct);

  const revenue = unitsPerMonth * blendedPrice;
  const grossProfit = revenue - productionCost;

  // Break-even: blendedPrice * units = variablePerUnit * units + fixedMonthly
  // units = fixedMonthly / (blendedPrice - variablePerUnit)
  let breakEvenUnits: number | null = null;
  const contribution = blendedPrice - variablePerUnit;
  if (contribution > 0 && fixedMonthly > 0) {
    breakEvenUnits = fixedMonthly / contribution;
  } else if (fixedMonthly === 0 && blendedPrice > variablePerUnit) {
    breakEvenUnits = 0;
  }

  return { unitsPerMonth, productionCost, revenue, grossProfit, breakEvenUnits };
}

export function unitLabel(u: DisplayUnit): string {
  return u === 'BAG' ? 'bag' : u === 'KG' ? 'kg' : 'lb';
}

export function unitLabelPlural(u: DisplayUnit): string {
  return u === 'BAG' ? 'bags' : u === 'KG' ? 'kg' : 'lb';
}
