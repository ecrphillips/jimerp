import { describe, it, expect } from 'vitest';
import {
  calculateLine,
  resolvePriceBreak,
  breaksDescendInMargin,
  type PriceBreak,
  type PricingLineInput,
} from './pricingEngine';
import type { PricingAssumptions, PackSpeedBand } from './pricingAssumptions';

const A: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 50,
  machine_running_cost_per_hr: 10,
  labour_salary_annual: 100000,
  labour_weeks_per_year: 50,
  labour_hours_per_week: 40,
  labour_oncost_pct: 0,
  standard_yield_loss_pct: 20,
  green_financing_days: 60,
  green_financing_apr_pct: 12,
};

const BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g', min_g: 0, max_g: 454, units_per_hour: 100, display_order: 1 },
  { id: '2', label: 'Over 454g', min_g: 455, max_g: null, units_per_hour: 50, display_order: 2 },
];

const BREAKS: PriceBreak[] = [
  { minUnitsPerPeriod: 200, marginPerGreenKg: 9 },
  { minUnitsPerPeriod: 500, marginPerGreenKg: 8 },
  { minUnitsPerPeriod: 1000, marginPerGreenKg: 7 },
];

const line = (over: Partial<PricingLineInput> = {}): PricingLineInput => ({
  tier: 'T4_PRIVATE_LABEL',
  greenBenchmarkPerKg: 10,
  green: { kind: 'FLAT', pricePerKg: 8 },
  gramsPerUnit: 1000,
  packagingMaterialPerUnit: 1,
  marginPerGreenKg: 10,
  priceBreaks: BREAKS,
  ...over,
});

const run = (over: Partial<PricingLineInput> = {}) => calculateLine(line(over), A, BANDS);

describe('resolving a break from volume', () => {
  it('applies no break below the first trigger', () => {
    expect(resolvePriceBreak(BREAKS, 199)).toBeNull();
  });

  it('applies a break exactly at its trigger', () => {
    expect(resolvePriceBreak(BREAKS, 200)?.marginPerGreenKg).toBe(9);
  });

  it('takes the highest trigger the volume reaches', () => {
    expect(resolvePriceBreak(BREAKS, 750)?.marginPerGreenKg).toBe(8);
    expect(resolvePriceBreak(BREAKS, 5000)?.marginPerGreenKg).toBe(7);
  });

  it('does not depend on the order they were entered', () => {
    const shuffled = [BREAKS[2], BREAKS[0], BREAKS[1]];
    expect(resolvePriceBreak(shuffled, 750)?.marginPerGreenKg).toBe(8);
  });

  it('applies nothing when volume is unset', () => {
    expect(resolvePriceBreak(BREAKS, null)).toBeNull();
    expect(resolvePriceBreak(BREAKS, 0)).toBeNull();
  });

  it('skips a tier with no margin set rather than pricing it at zero', () => {
    const halfFilled: PriceBreak[] = [
      { minUnitsPerPeriod: 200, marginPerGreenKg: 9 },
      { minUnitsPerPeriod: 500, marginPerGreenKg: null },
    ];
    // 600 units reaches the unfilled tier; it falls back to the one below.
    expect(resolvePriceBreak(halfFilled, 600)?.marginPerGreenKg).toBe(9);
  });

  it('applies nothing when there are no breaks', () => {
    expect(resolvePriceBreak([], 5000)).toBeNull();
    expect(resolvePriceBreak(undefined, 5000)).toBeNull();
  });
});

describe('breaks move the dial, never the floor', () => {
  it('leaves the cost floor identical at every volume', () => {
    const floors = [100, 250, 750, 2000].map(
      (u) => run({ unitsPerPeriod: u }).costFloorPerUnit as number,
    );
    for (const f of floors) expect(f).toBeCloseTo(floors[0], 12);
  });

  it('lowers the price as volume rises', () => {
    const small = run({ unitsPerPeriod: 100 }).pricePerUnit as number;
    const mid = run({ unitsPerPeriod: 600 }).pricePerUnit as number;
    const large = run({ unitsPerPeriod: 2000 }).pricePerUnit as number;
    expect(mid).toBeLessThan(small);
    expect(large).toBeLessThan(mid);
  });

  it('uses the base dial below the first trigger', () => {
    const r = run({ unitsPerPeriod: 100 });
    expect(r.appliedBreak).toBeNull();
    expect(r.marginPerGreenKg).toBe(10);
  });

  it('reports the base dial alongside the one in force', () => {
    const r = run({ unitsPerPeriod: 2000 });
    expect(r.baseMarginPerGreenKg).toBe(10);
    expect(r.marginPerGreenKg).toBe(7);
    expect(r.appliedBreak?.minUnitsPerPeriod).toBe(1000);
  });

  it('prices margin per unit off the discounted dial', () => {
    const r = run({ unitsPerPeriod: 2000 });
    // green consumed for a 1000g unit at 20% loss = 1.25 kg
    expect(r.marginPerUnit).toBeCloseTo(7 * 1.25, 9);
  });
});

describe('breaks that would go wrong', () => {
  it('warns when a break leaves no margin at all', () => {
    const r = run({
      unitsPerPeriod: 2000,
      priceBreaks: [{ minUnitsPerPeriod: 1000, marginPerGreenKg: 0 }],
    });
    expect(r.warnings.some((w) => w.kind === 'BREAK_BELOW_FLOOR')).toBe(true);
    // the floor is still intact and still reported
    expect(r.costFloorPerUnit).not.toBeNull();
    expect(r.pricePerUnit).toBeCloseTo(r.costFloorPerUnit as number, 9);
  });

  it('warns when buying more would pay us better', () => {
    const inverted: PriceBreak[] = [
      { minUnitsPerPeriod: 200, marginPerGreenKg: 8 },
      { minUnitsPerPeriod: 500, marginPerGreenKg: 9 },
    ];
    expect(breaksDescendInMargin(inverted)).toBe(false);
    const r = run({ unitsPerPeriod: 600, priceBreaks: inverted });
    expect(r.warnings.some((w) => w.kind === 'BREAK_NOT_ASCENDING')).toBe(true);
  });

  it('accepts a properly descending ladder', () => {
    expect(breaksDescendInMargin(BREAKS)).toBe(true);
    const r = run({ unitsPerPeriod: 600 });
    expect(r.warnings.some((w) => w.kind === 'BREAK_NOT_ASCENDING')).toBe(false);
  });

  it('treats an equal margin across two tiers as acceptable', () => {
    const flat: PriceBreak[] = [
      { minUnitsPerPeriod: 200, marginPerGreenKg: 8 },
      { minUnitsPerPeriod: 500, marginPerGreenKg: 8 },
    ];
    expect(breaksDescendInMargin(flat)).toBe(true);
  });

  it('still refuses a price when the stack is incomplete, break or not', () => {
    const r = run({ unitsPerPeriod: 2000, packagingMaterialPerUnit: null });
    expect(r.pricePerUnit).toBeNull();
    expect(r.incomplete).toContain('Packaging material');
  });
});
