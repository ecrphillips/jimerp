import { describe, it, expect } from 'vitest';
import { calculateLine, forecast, type PricingLineInput } from './pricingEngine';
import type { PricingAssumptions, PackSpeedBand } from './pricingAssumptions';

/**
 * Toll roasting has no bag. Nothing is packaged, so nothing is charged per
 * finished item, and the whole line is priced per green kg. These pin that the
 * cost floor is knowable from the assumptions alone — no packaging input, no
 * finished weight, nothing else to fill in.
 */

// 45 green kg/hr, $10/hr machine, $45/hr loaded labour.
const A: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 45,
  machine_running_cost_per_hr: 10,
  labour_salary_annual: 88200,
  labour_weeks_per_year: 49,
  labour_hours_per_week: 40,
  labour_oncost_pct: 0,
  standard_yield_loss_pct: 17,
  green_financing_days: 30,
  green_financing_apr_pct: 15,
};

const BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g', min_g: 0, max_g: 454, units_per_hour: 60, display_order: 1 },
  { id: '2', label: 'Over 454g', min_g: 455, max_g: null, units_per_hour: 30, display_order: 2 },
];

const toll = (over: Partial<PricingLineInput> = {}): PricingLineInput => ({
  tier: 'T2_TOLL',
  green: { kind: 'NONE' },
  gramsPerUnit: null,
  packagingMaterialPerUnit: null,
  marginPerGreenKg: 4,
  ...over,
});

const run = (over: Partial<PricingLineInput> = {}) => calculateLine(toll(over), A, BANDS);

// $88,200 / (49 x 40) = $45.00/hr loaded at 0% oncosts
const LOADED = 45;
const MACHINE_PER_KG = 10 / 45;
const LABOUR_PER_KG = LOADED / 45;

describe('a toll line is priced by weight', () => {
  it('reports itself as weight-priced', () => {
    expect(run().isWeightPriced).toBe(true);
  });

  it('has a cost floor from the assumptions alone', () => {
    // No packaging, no finished weight, no green — nothing else to supply.
    const r = run();
    expect(r.incomplete).toEqual([]);
    expect(r.costFloorPerGreenKg).toBeCloseTo(MACHINE_PER_KG + LABOUR_PER_KG, 10);
  });

  it('is exactly labour plus roaster time over throughput', () => {
    expect(run().costFloorPerGreenKg).toBeCloseTo((10 + LOADED) / 45, 10);
  });

  it('adds the dial on top of that floor', () => {
    const r = run();
    expect(r.pricePerGreenKg).toBeCloseTo((10 + LOADED) / 45 + 4, 10);
  });

  it('has no per-unit figures at all', () => {
    const r = run();
    expect(r.greenKgPerUnit).toBeNull();
    expect(r.costFloorPerUnit).toBeNull();
    expect(r.pricePerUnit).toBeNull();
  });

  it('charges no green — the coffee belongs to the client', () => {
    const green = run().lines.find((l) => l.key === 'green')!;
    expect(green.included).toBe(false);
    expect(green.rate).toBeNull();
  });

  it('does not ask for packaging it will never charge', () => {
    const r = run();
    for (const key of ['packagingMaterial', 'packLabour'] as const) {
      const l = r.lines.find((x) => x.key === key)!;
      expect(l.included, key).toBe(false);
    }
    expect(r.incomplete).not.toContain('Packaging material');
    expect(r.incomplete).not.toContain('Pack labour');
  });

  it('is unaffected by a packaging cost supplied anyway', () => {
    const withPkg = run({ packagingMaterialPerUnit: 5 }).costFloorPerGreenKg;
    expect(withPkg).toBeCloseTo(run().costFloorPerGreenKg as number, 10);
  });
});

describe('a toll line stops being weight-priced when packaging is switched on', () => {
  it('flips to unit pricing under toll plus with packaging', () => {
    const r = calculateLine(
      toll({
        tier: 'T3_TOLL_PLUS',
        configOverrides: { packagingMaterial: true, packLabour: true },
        gramsPerUnit: 340,
        packagingMaterialPerUnit: 0.75,
      }),
      A,
      BANDS,
    );
    expect(r.isWeightPriced).toBe(false);
    expect(r.costFloorPerUnit).not.toBeNull();
  });
});

describe('forecasting a toll line', () => {
  it('multiplies through green kg, not units', () => {
    const r = run();
    const f = forecast(r, { cadence: 'MONTHLY', greenKgPerPeriod: 500 });
    expect(f.greenKgPerPeriod).toBe(500);
    expect(f.marginPerPeriod).toBeCloseTo(4 * 500, 6);
    expect(f.revenuePerPeriod).toBeCloseTo((r.pricePerGreenKg as number) * 500, 6);
    expect(f.costPerPeriod).toBeCloseTo((r.costFloorPerGreenKg as number) * 500, 6);
  });

  it('ignores a units figure on a weight-priced line', () => {
    // Passing units to a line with no unit must not silently produce a number.
    const f = forecast(run(), { cadence: 'MONTHLY', unitsPerPeriod: 500 });
    expect(f.revenuePerPeriod).toBeNull();
  });

  it('still normalises a weekly cadence to a monthly equivalent', () => {
    const weekly = forecast(run(), { cadence: 'WEEKLY', greenKgPerPeriod: 100 });
    expect(weekly.marginPerMonth).toBeCloseTo((weekly.marginPerPeriod as number) * (52 / 12), 6);
  });
});
