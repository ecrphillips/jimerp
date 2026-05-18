/**
 * Client (wholesale buyer) Unit Economics — wraps the shared engine in src/lib/unitEconomics.ts.
 *
 * Manufacturing clients buy finished roasted coffee from us. Their per-bag cost from Home Island
 * replaces the green+roasting cost stack used by the co-roasting calculator. We translate the
 * client-shaped inputs into UnitEconomicsInputs and reuse the existing math.
 */
import {
  DEFAULT_INPUTS,
  costPerUnit,
  marginAt,
  monthlyView,
  type UnitEconomicsInputs,
  type DisplayUnit,
  type CostBreakdown,
  type MarginRow,
  type MonthlyView,
} from '@/lib/unitEconomics';

export type PaceMode = 'CURRENT' | 'SEASONAL';

export interface ClientUnitEconomicsInputs {
  displayUnit: DisplayUnit;       // BAG | KG | LB
  bagSizeG: number;

  // Which JIM product this scenario models (optional but recommended)
  productId: string | null;
  productName: string | null;

  // Pace / volume
  paceMode: PaceMode;
  monthlyKg: number | null;

  // Per-bag cost paid TO Home Island (pre-fills from order history)
  costPerBagFromUs: number | null;

  // Additional per-bag packaging the client adds (their own labels, inserts, etc.)
  extraPackagingPerBag: number | null;

  // Labour
  includeLabour: boolean;
  labourHoursPerBatch: number;
  labourRatePerHr: number;
  batchSizeKg: number;

  // Overhead
  overheadMonthly: number | null;

  // Pricing
  wholesalePrice: number | null;
  retailPrice: number | null;
  wholesalePct: number;

  // MSRP suggestion
  targetRetailMarginPct: number;
}

export const DEFAULT_CLIENT_INPUTS: ClientUnitEconomicsInputs = {
  displayUnit: 'BAG',
  bagSizeG: 340,
  productId: null,
  productName: null,
  paceMode: 'CURRENT',
  monthlyKg: null,
  costPerBagFromUs: null,
  extraPackagingPerBag: null,
  includeLabour: false,
  labourHoursPerBatch: 0,
  labourRatePerHr: 25,
  batchSizeKg: 40,
  overheadMonthly: null,
  wholesalePrice: null,
  retailPrice: null,
  wholesalePct: 50,
  targetRetailMarginPct: 50,
};

/**
 * Translate client-shaped inputs into the shared UnitEconomicsInputs shape so we can reuse
 * the existing math engine without modification.
 *
 * Strategy: stash the client's per-bag cost from us into the "green" slot, converting it
 * to a $/kg value that — when multiplied by (bagSizeG/1000) and a zero-loss factor —
 * reproduces the original per-bag cost exactly.
 */
export function toEngineInputs(c: ClientUnitEconomicsInputs): UnitEconomicsInputs {
  const bagG = Math.max(1, c.bagSizeG || 340);
  const costPerBag = c.costPerBagFromUs ?? 0;
  // costPerKg such that (bagG / 1000) * costPerKg == costPerBag
  const costPerKgRoasted = costPerBag * (1000 / bagG);

  return {
    ...DEFAULT_INPUTS,
    displayUnit: c.displayUnit,
    bagSizeG: bagG,
    greenPriceUnit: 'KG',
    greenPrice: c.costPerBagFromUs == null ? null : costPerKgRoasted,
    yieldLossPct: 0,
    packagingPerBag: c.extraPackagingPerBag,
    tier: null,
    forecastOverage: false,
    includeLabour: c.includeLabour,
    labourHoursPerBatch: c.labourHoursPerBatch,
    labourRatePerHr: c.labourRatePerHr,
    batchSizeKg: c.batchSizeKg,
    overheadMonthly: c.overheadMonthly,
    monthlyKg: c.monthlyKg,
    wholesalePrice: c.wholesalePrice,
    retailPrice: c.retailPrice,
    wholesalePct: c.wholesalePct,
  };
}

export interface ClientCalcResult {
  engineInputs: UnitEconomicsInputs;
  perUnit: CostBreakdown;
  wholesaleMargin: MarginRow;
  retailMargin: MarginRow;
  monthly: MonthlyView;
  suggestedRetailPrice: number;
}

export function calculateClientUnitEconomics(c: ClientUnitEconomicsInputs): ClientCalcResult {
  const engineInputs = toEngineInputs(c);
  const perUnit = costPerUnit(engineInputs);
  const wholesaleMargin = marginAt(c.wholesalePrice, perUnit.total);
  const retailMargin = marginAt(c.retailPrice, perUnit.total);
  const monthly = monthlyView(engineInputs, perUnit);

  // Suggested MSRP: price such that (price - cost) / price = targetMargin%
  // → price = cost / (1 - targetMargin)
  const tgt = Math.min(0.99, Math.max(0, (c.targetRetailMarginPct || 0) / 100));
  const suggestedRetailPrice = tgt < 1
    ? perUnit.total / (1 - tgt || 1)
    : perUnit.total * 2;

  return { engineInputs, perUnit, wholesaleMargin, retailMargin, monthly, suggestedRetailPrice };
}
