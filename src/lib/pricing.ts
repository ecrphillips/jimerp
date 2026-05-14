/**
 * Pricing engine — pure function.
 *
 * Currency arithmetic uses decimal.js to avoid binary-float precision drift.
 */
import Decimal from 'decimal.js';

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

const dec = (v: unknown, fallback = 0): Decimal => {
  try {
    const d = new Decimal(v as Decimal.Value);
    return d.isFinite() ? d : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
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

  const yieldLossClamped = Math.max(0, yieldLoss);
  const green_consumed_per_unit_d = dec(bag_size_g)
    .div(1000)
    .div(new Decimal(1).minus(dec(yieldLossClamped).div(100)));

  const greenMarket = dec(Math.max(0, num(inputs.green_market_per_kg)));
  const processRate = dec(Math.max(0, num(inputs.process_per_kg_green)));
  const pkgMaterial = dec(Math.max(0, num(inputs.pkg_material_per_unit)));
  const pkgLabour = dec(Math.max(0, num(inputs.pkg_labour_per_unit)));
  const adjustment = dec(num(inputs.adjustment_per_unit));

  const roasted_coffee_cost_d = greenMarket.times(green_consumed_per_unit_d);
  const process_per_unit_d = processRate.times(green_consumed_per_unit_d);

  const price_per_unit_d = roasted_coffee_cost_d
    .plus(process_per_unit_d)
    .plus(pkgMaterial)
    .plus(pkgLabour)
    .plus(adjustment);
  const cost_per_unit_d = roasted_coffee_cost_d.plus(pkgMaterial);

  let margin_pct_d = new Decimal(0);
  if (price_per_unit_d.gt(0)) {
    margin_pct_d = price_per_unit_d.minus(cost_per_unit_d).div(price_per_unit_d);
  } else {
    console.warn('[pricing] zero or negative price_per_unit — margin defaulted to 0', {
      price_per_unit: price_per_unit_d.toNumber(),
      cost_per_unit: cost_per_unit_d.toNumber(),
      bag_size_g,
      green_market_per_kg: greenMarket.toNumber(),
      yield_loss_pct: yieldLossClamped,
      process_per_kg_green: processRate.toNumber(),
      pkg_material_per_unit: pkgMaterial.toNumber(),
      pkg_labour_per_unit: pkgLabour.toNumber(),
      adjustment_per_unit: adjustment.toNumber(),
    });
  }

  return {
    inputs,
    green_consumed_per_unit: green_consumed_per_unit_d.toNumber(),
    roasted_coffee_cost_per_unit: roasted_coffee_cost_d.toNumber(),
    process_per_unit: process_per_unit_d.toNumber(),
    pkg_material_per_unit: pkgMaterial.toNumber(),
    pkg_labour_per_unit: pkgLabour.toNumber(),
    adjustment_per_unit: adjustment.toNumber(),
    price_per_unit: price_per_unit_d.toNumber(),
    cost_per_unit: cost_per_unit_d.toNumber(),
    margin_pct: margin_pct_d.toNumber(),
  };
}
