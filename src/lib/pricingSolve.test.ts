import { describe, it, expect } from 'vitest';
import {
  calculateLine,
  solveMarginForTargetPrice,
  type PricingLineInput,
} from './pricingEngine';
import type { PricingAssumptions, PackSpeedBand } from './pricingAssumptions';

/**
 * Working backwards from a round number.
 *
 * The engine runs cost-plus, but quoting does not: a client is told $12.00 a
 * bag, and the margin is whatever that leaves. Solving for the dial lets the
 * round number be the input, which is how the conversation actually goes.
 */

const A: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 45,
  machine_running_cost_per_hr: 10,
  labour_salary_annual: 75000,
  labour_weeks_per_year: 49,
  labour_hours_per_week: 37.5,
  labour_oncost_pct: 10,
  standard_yield_loss_pct: 17,
  green_financing_days: 30,
  green_financing_apr_pct: 15,
};

const BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g', min_g: 0, max_g: 454, units_per_hour: 60, display_order: 1 },
  { id: '2', label: 'Over 454g', min_g: 455, max_g: null, units_per_hour: 30, display_order: 2 },
];

const bagged = (over: Partial<PricingLineInput> = {}): PricingLineInput => ({
  tier: 'T5_CO_PACK',
  greenBenchmarkPerKg: 18,
  green: { kind: 'FLAT', pricePerKg: null },
  gramsPerUnit: 300,
  packagingMaterialPerUnit: 0.75,
  marginPerGreenKg: 11.5743,
  ...over,
});

const run = (over: Partial<PricingLineInput> = {}) => calculateLine(bagged(over), A, BANDS);

/** Re-price with the solved dial and check the target comes back out. */
const priceAt = (margin: number, over: Partial<PricingLineInput> = {}) =>
  calculateLine(bagged({ ...over, marginPerGreenKg: margin }), A, BANDS);

describe('a bagged line', () => {
  it('solves the dial that lands on a round price', () => {
    const r = run();
    const solved = solveMarginForTargetPrice(r, 12)!;
    expect(priceAt(solved).pricePerUnit).toBeCloseTo(12, 9);
  });

  it('round-trips any target it is given', () => {
    const r = run();
    for (const target of [9.5, 12, 15.25, 20]) {
      const solved = solveMarginForTargetPrice(r, target)!;
      expect(priceAt(solved).pricePerUnit).toBeCloseTo(target, 9);
    }
  });

  it('returns the floor exactly when the target is the floor', () => {
    const r = run();
    const solved = solveMarginForTargetPrice(r, r.costFloorPerUnit as number)!;
    expect(solved).toBeCloseTo(0, 9);
  });
});

describe('a line sold by roasted weight', () => {
  const bulk = (over: Partial<PricingLineInput> = {}): PricingLineInput =>
    bagged({
      configOverrides: { packagingMaterial: false, packLabour: false },
      gramsPerUnit: null,
      packagingMaterialPerUnit: null,
      ...over,
    });

  it('solves through the yield loss, not around it', () => {
    const r = calculateLine(bulk(), A, BANDS);
    expect(r.saleBasis).toBe('ROASTED_WEIGHT');
    const solved = solveMarginForTargetPrice(r, 25)!;
    const repriced = calculateLine(bulk({ marginPerGreenKg: solved }), A, BANDS);
    expect(repriced.pricePerRoastedKg).toBeCloseTo(25, 9);
  });

  it('does not solve the green price by mistake', () => {
    // The green figure is 83% of the roasted one, so solving on the wrong basis
    // would leave the quote short by the yield loss.
    const r = calculateLine(bulk(), A, BANDS);
    const solved = solveMarginForTargetPrice(r, 25)!;
    const repriced = calculateLine(bulk({ marginPerGreenKg: solved }), A, BANDS);
    expect(repriced.pricePerGreenKg as number).toBeLessThan(25);
  });
});

describe('a toll line', () => {
  const toll = (over: Partial<PricingLineInput> = {}): PricingLineInput =>
    bagged({
      tier: 'T2_TOLL',
      green: { kind: 'NONE' },
      gramsPerUnit: null,
      packagingMaterialPerUnit: null,
      ...over,
    });

  it('solves on green weight, which is what toll work charges', () => {
    const r = calculateLine(toll(), A, BANDS);
    expect(r.saleBasis).toBe('GREEN_WEIGHT');
    const solved = solveMarginForTargetPrice(r, 5)!;
    const repriced = calculateLine(toll({ marginPerGreenKg: solved }), A, BANDS);
    expect(repriced.pricePerGreenKg).toBeCloseTo(5, 9);
  });
});

describe('what cannot be solved', () => {
  it('refuses when there is no floor to work back from', () => {
    // A price with no known cost underneath it is not a margin, it is a guess.
    const r = run({ packagingMaterialPerUnit: null });
    expect(r.costFloorPerUnit).toBeNull();
    expect(solveMarginForTargetPrice(r, 12)).toBeNull();
  });

  it('refuses an unset target', () => {
    expect(solveMarginForTargetPrice(run(), null)).toBeNull();
  });
});

describe('a target below the floor', () => {
  it('solves to a negative dial rather than refusing', () => {
    // Selling under cost is sometimes a decision; the engine warns about it
    // rather than the solver pretending it cannot be expressed.
    const r = run();
    const under = (r.costFloorPerUnit as number) - 1;
    const solved = solveMarginForTargetPrice(r, under)!;
    expect(solved).toBeLessThan(0);
  });

  it('carries the warning through when repriced', () => {
    const r = run();
    const solved = solveMarginForTargetPrice(r, (r.costFloorPerUnit as number) - 1)!;
    const repriced = priceAt(solved);
    expect(repriced.warnings.some((x) => x.kind === 'NEGATIVE_MARGIN')).toBe(true);
    expect(repriced.pricePerUnit as number).toBeLessThan(repriced.costFloorPerUnit as number);
  });
});
