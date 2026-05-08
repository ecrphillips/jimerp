/**
 * Pricing engine — pure function.
 *
 * No database calls. All inputs are passed in by the caller (CalculatorTab,
 * MixingConsole, etc.). Same inputs always produce same outputs.
 *
 * Formula:
 *   green_consumed_per_unit  = bag_size_g / 1000 / (1 - yield_loss_pct/100)
 *   roasted_coffee_cost      = green_market_per_kg * green_consumed_per_unit
 *   process_per_unit         = process_per_kg_green * green_consumed_per_unit
 *   price_per_unit           = roasted_coffee_cost + process_per_unit + pkg_material + pkg_labour + adjustment
 *   cost_per_unit            = roasted_coffee_cost + pkg_material
 *   margin_pct               = (price - cost) / price
 */

export type PricingInputs = {
  green_market_per_kg: number;
  yield_loss_pct: number;
  process_per_kg_green: number;
  pkg_material_per_unit: number;
  pkg_labour_per_unit: number;
  adjustment_per_unit: number;
  adjustment_note?: string | null;
  bag_size_g: number;
};

export type PricingResult = {
  inputs: PricingInputs;
  green_consumed_per_unit: number;
  roasted_coffee_cost_per_unit: number;
  process_per_unit: number;
  pkg_material_per_unit: number;
  pkg_labour_per_unit: number;
  adjustment_per_unit: number;
  price_per_unit: number;
  cost_per_unit: number;
  margin_pct: number;
};

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function calculatePrice(inputs: PricingInputs): PricingResult {
  const bag_size_g = num(inputs.bag_size_g);
  if (bag_size_g <= 0) {
    throw new Error('Pricing: bag_size_g must be > 0.');
  }
  const yieldLoss = num(inputs.yield_loss_pct);
  if (yieldLoss >= 100) {
    throw new Error('Pricing: yield_loss_pct must be < 100.');
  }

  const green_consumed_per_unit =
    bag_size_g / 1000 / (1 - Math.max(0, yieldLoss) / 100);

  const greenMarket = Math.max(0, num(inputs.green_market_per_kg));
  const processRate = Math.max(0, num(inputs.process_per_kg_green));
  const pkgMaterial = Math.max(0, num(inputs.pkg_material_per_unit));
  const pkgLabour = Math.max(0, num(inputs.pkg_labour_per_unit));
  const adjustment = num(inputs.adjustment_per_unit);

  const roasted_coffee_cost_per_unit = greenMarket * green_consumed_per_unit;
  const process_per_unit = processRate * green_consumed_per_unit;

  const price_per_unit =
    roasted_coffee_cost_per_unit + process_per_unit + pkgMaterial + pkgLabour + adjustment;
  const cost_per_unit = roasted_coffee_cost_per_unit + pkgMaterial;
  const margin_pct = price_per_unit > 0 ? (price_per_unit - cost_per_unit) / price_per_unit : 0;

  return {
    inputs,
    green_consumed_per_unit,
    roasted_coffee_cost_per_unit,
    process_per_unit,
    pkg_material_per_unit: pkgMaterial,
    pkg_labour_per_unit: pkgLabour,
    adjustment_per_unit: adjustment,
    price_per_unit,
    cost_per_unit,
    margin_pct,
  };
}
