import { describe, it, expect } from 'vitest';
import { calculateLine, forecast, TIER_PRESETS, type PricingLineInput } from './pricingEngine';
import { KG_PER_LB, type PricingAssumptions, type PackSpeedBand } from './pricingAssumptions';

/**
 * Bulk roasted coffee, sold by the weight that leaves the roaster — totes the
 * client repacks themselves. No bag, but not toll work either: we own the
 * green and are selling roasted pounds.
 *
 * The distinction is worth real money. At 17% yield loss a roasted kilogram
 * consumes 1.2048 green kilograms, so quoting the green figure for roasted
 * coffee undercharges by the whole yield loss on every pound sold.
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

/** Bulk totes: we own the green, nothing is packaged, sold by roasted weight. */
const bulk = (over: Partial<PricingLineInput> = {}): PricingLineInput => ({
  tier: 'T4_PRIVATE_LABEL',
  configOverrides: { packagingMaterial: false, packLabour: false },
  greenBenchmarkPerKg: 18,
  green: { kind: 'FLAT', pricePerKg: null },
  gramsPerUnit: null,
  packagingMaterialPerUnit: null,
  marginPerGreenKg: 11.5743, // $5.25 per green lb
  ...over,
});

const run = (over: Partial<PricingLineInput> = {}) => calculateLine(bulk(over), A, BANDS);

const GREEN_PER_ROASTED = 1 / (1 - 0.17); // 1.204819...

describe('selling roasted weight is not the same as selling green weight', () => {
  it('defaults to roasted weight once we own the coffee', () => {
    expect(run().saleBasis).toBe('ROASTED_WEIGHT');
    expect(TIER_PRESETS.T4_PRIVATE_LABEL.defaultWeightSaleBasis).toBe('ROASTED_WEIGHT');
  });

  it('still charges toll work on green, because that is what they buy', () => {
    const toll = run({ tier: 'T2_TOLL', green: { kind: 'NONE' } });
    expect(toll.saleBasis).toBe('GREEN_WEIGHT');
  });

  it('knows how much green a roasted kilogram consumes', () => {
    expect(run().greenKgPerRoastedKg).toBeCloseTo(GREEN_PER_ROASTED, 9);
  });

  it('costs more per roasted kilogram than per green one', () => {
    // The whole point: a roasted kg took more than a kg of green to make.
    const r = run();
    expect(r.costFloorPerRoastedKg as number).toBeGreaterThan(r.costFloorPerGreenKg as number);
    expect(r.costFloorPerRoastedKg).toBeCloseTo(
      (r.costFloorPerGreenKg as number) * GREEN_PER_ROASTED,
      9,
    );
  });

  it('marks up the price by exactly the yield loss', () => {
    const r = run();
    expect(r.pricePerRoastedKg).toBeCloseTo((r.pricePerGreenKg as number) * GREEN_PER_ROASTED, 9);
  });

  it('would undercharge by about a fifth if the green figure were quoted', () => {
    // 17% loss means the green price is 83% of the roasted one. Pinning the
    // size of the mistake, since that is what makes it worth preventing.
    const r = run();
    const understated = (r.pricePerGreenKg as number) / (r.pricePerRoastedKg as number);
    expect(understated).toBeCloseTo(0.83, 4);
  });
});

describe('the arithmetic of a bulk tote quote', () => {
  it('builds the floor from green, roaster time and roast labour only', () => {
    const r = run();
    // loaded labour 75000/(49*37.5)*1.1 = 44.89795918367347
    const loaded = (75000 / (49 * 37.5)) * 1.1;
    const perGreenKg = 18 + 10 / 45 + loaded / 45;
    expect(r.costFloorPerGreenKg).toBeCloseTo(perGreenKg, 9);
    expect(r.costFloorPerRoastedKg).toBeCloseTo(perGreenKg * GREEN_PER_ROASTED, 9);
  });

  it('charges nothing for packaging that is not supplied', () => {
    const r = run();
    for (const key of ['packagingMaterial', 'packLabour'] as const) {
      expect(r.lines.find((l) => l.key === key)!.included, key).toBe(false);
    }
    expect(r.incomplete).toEqual([]);
  });

  it('gives a per-pound figure a client would recognise', () => {
    const r = run();
    const perRoastedLb = (r.pricePerRoastedKg as number) * KG_PER_LB;
    // Sanity band rather than a fixed figure: a bulk roasted pound at these
    // assumptions lands in the teens, not in single digits or the twenties.
    expect(perRoastedLb).toBeGreaterThan(10);
    expect(perRoastedLb).toBeLessThan(20);
  });
});

describe('forecasting bulk roasted volume', () => {
  it('multiplies through roasted weight, not green', () => {
    const r = run();
    const f = forecast(r, { cadence: 'MONTHLY', roastedKgPerPeriod: 500 });
    expect(f.revenuePerPeriod).toBeCloseTo((r.pricePerRoastedKg as number) * 500, 6);
    expect(f.costPerPeriod).toBeCloseTo((r.costFloorPerRoastedKg as number) * 500, 6);
  });

  it('reports the green it will actually consume, which is more', () => {
    const f = forecast(run(), { cadence: 'MONTHLY', roastedKgPerPeriod: 500 });
    // 500 roasted kg needs about 602 green kg, and that is what gets bought.
    expect(f.greenKgPerPeriod).toBeCloseTo(500 * GREEN_PER_ROASTED, 6);
  });

  it('ignores a green volume on a roasted-weight line', () => {
    const f = forecast(run(), { cadence: 'MONTHLY', greenKgPerPeriod: 500 });
    expect(f.revenuePerPeriod).toBeNull();
  });

  it('still normalises weekly to a monthly equivalent', () => {
    const weekly = forecast(run(), { cadence: 'WEEKLY', roastedKgPerPeriod: 100 });
    expect(weekly.marginPerMonth).toBeCloseTo((weekly.marginPerPeriod as number) * (52 / 12), 6);
  });
});

describe('an explicit choice overrides the tier default', () => {
  it('can charge private label work on green if that is the deal', () => {
    const r = run({ saleBasis: 'GREEN_WEIGHT' });
    expect(r.saleBasis).toBe('GREEN_WEIGHT');
  });

  it('ignores a weight basis when packaging makes it a unit sale', () => {
    const r = run({
      configOverrides: { packagingMaterial: true, packLabour: true },
      gramsPerUnit: 340,
      packagingMaterialPerUnit: 0.75,
      saleBasis: 'ROASTED_WEIGHT',
    });
    // There is a bag, so the sale is per bag whatever the basis said.
    expect(r.saleBasis).toBe('UNIT');
    expect(r.pricePerUnit).not.toBeNull();
  });
});
