import { describe, it, expect } from 'vitest';
import {
  calculateLine,
  forecast,
  blendedGreenPricePerKg,
  blendSharesTotal,
  TIER_PRESETS,
  TIER_ORDER,
  WEEKS_PER_MONTH,
  type PricingLineInput,
  type CostLineKey,
} from './pricingEngine';
import { KG_PER_LB, type PricingAssumptions, type PackSpeedBand } from './pricingAssumptions';

/**
 * Illustrative rates. Deliberately round so that expected values can be derived
 * by hand in the assertions rather than copied from the implementation.
 *
 * NOTE: these are NOT the operator's real rates. Gate C replaces the assertions
 * about real-world prices with fixtures built from actual priced products.
 */
const A: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 50, // round number: $10/hr -> $0.20/green kg
  machine_running_cost_per_hr: 10,
  labour_salary_annual: 100000,
  labour_weeks_per_year: 50,
  labour_hours_per_week: 40, // 100000 / 2000 = $50/hr base
  labour_oncost_pct: 0, // loaded == base, keeps arithmetic transparent
  standard_yield_loss_pct: 20, // 1 kg roasted needs 1.25 kg green
  green_financing_days: 60,
  green_financing_apr_pct: 12,
};

const BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g (1 lb)', min_g: 0, max_g: 454, units_per_hour: 100, display_order: 1 },
  { id: '2', label: '455g - 1135g', min_g: 455, max_g: 1135, units_per_hour: 50, display_order: 2 },
  { id: '3', label: '1136g - 2270g', min_g: 1136, max_g: 2270, units_per_hour: 25, display_order: 3 },
  { id: '4', label: 'Over 2270g', min_g: 2271, max_g: null, units_per_hour: 10, display_order: 4 },
];

// With the rates above:
//   machine      = 10 / 50            = $0.20 / green kg
//   roast labour = 50 / 50            = $1.00 / green kg
//   green kg for a 1000g unit         = 1.0 / (1 - 0.20) = 1.25 kg
//   pack labour for a <=454g unit     = 50 / 100 = $0.50 / unit

const line = (over: Partial<PricingLineInput> = {}): PricingLineInput => ({
  tier: 'T4_PRIVATE_LABEL',
  green: { kind: 'FLAT', pricePerKg: 10 },
  gramsPerUnit: 1000,
  packagingMaterialPerUnit: 1,
  marginPerGreenKg: 4,
  ...over,
});

const run = (over: Partial<PricingLineInput> = {}) => calculateLine(line(over), A, BANDS);

const lineByKey = (r: ReturnType<typeof run>, key: CostLineKey) =>
  r.lines.find((l) => l.key === key)!;

describe('tier presets', () => {
  it('excludes tier 1 — co-roasting is priced on roaster time elsewhere', () => {
    expect(TIER_ORDER).not.toContain('T1_CO_ROAST' as never);
    expect(TIER_ORDER).toHaveLength(5);
  });

  it('puts the green capitalization line between T3 and T4', () => {
    expect(TIER_PRESETS.T2_TOLL.ownsGreen).toBe(false);
    expect(TIER_PRESETS.T3_TOLL_PLUS.ownsGreen).toBe(false);
    expect(TIER_PRESETS.T4_PRIVATE_LABEL.ownsGreen).toBe(true);
    expect(TIER_PRESETS.T5_CO_PACK.ownsGreen).toBe(true);
    expect(TIER_PRESETS.T6_WHITE_GLOVE.ownsGreen).toBe(true);
  });

  it('charges roaster time and roast labour in every tier it builds', () => {
    for (const key of TIER_ORDER) {
      expect(TIER_PRESETS[key].config.roasterRunning, key).toBe(true);
      expect(TIER_PRESETS[key].config.roastLabour, key).toBe(true);
    }
  });

  it('gives T4 and T5 an identical cost stack — only the picker differs', () => {
    expect(TIER_PRESETS.T5_CO_PACK.config).toEqual(TIER_PRESETS.T4_PRIVATE_LABEL.config);
  });

  it('excludes green from toll tiers and includes it once we own it', () => {
    expect(TIER_PRESETS.T2_TOLL.config.green).toBe(false);
    expect(TIER_PRESETS.T3_TOLL_PLUS.config.green).toBe(false);
    expect(TIER_PRESETS.T4_PRIVATE_LABEL.config.green).toBe(true);
  });

  it('lets an override move a line off its preset — tiers are not segments', () => {
    const r = run({ tier: 'T3_TOLL_PLUS', configOverrides: { packagingMaterial: true } });
    expect(lineByKey(r, 'packagingMaterial').included).toBe(true);
    // and the preset itself is untouched
    expect(TIER_PRESETS.T3_TOLL_PLUS.config.packagingMaterial).toBe(false);
  });
});

describe('the ladder adds up', () => {
  it('computes each line from the assumptions', () => {
    const r = run();
    expect(lineByKey(r, 'roasterRunning').rate).toBeCloseTo(0.2, 9);
    expect(lineByKey(r, 'roastLabour').rate).toBeCloseTo(1.0, 9);
    expect(lineByKey(r, 'packLabour').rate).toBeCloseTo(1.0, 9); // 1000g -> 455-1135 band: $50/hr / 50 per hr
    expect(r.greenKgPerUnit).toBeCloseTo(1.25, 9);

    // a 340g unit falls in the lighter band at 100/hr => $0.50
    const light = run({ gramsPerUnit: 340 });
    expect(lineByKey(light, 'packLabour').rate).toBeCloseTo(0.5, 9);
  });

  it('sums the floor as (per-green-kg x green consumed) + per-unit', () => {
    const r = run();
    // (10 + 0.20 + 1.00) x 1.25  +  (1 packaging + 1 pack labour)
    // pack labour for 1000g uses the 455-1135 band at 50/hr => $1.00
    const expected = (10 + 0.2 + 1.0) * 1.25 + 1 + 1.0;
    expect(r.costFloorPerUnit).toBeCloseTo(expected, 9);
  });

  it('adds margin as dial x green consumed', () => {
    const r = run();
    expect(r.marginPerUnit).toBeCloseTo(4 * 1.25, 9);
    expect(r.pricePerUnit).toBeCloseTo((r.costFloorPerUnit as number) + 4 * 1.25, 9);
  });

  it('shows the dial in pounds alongside kilograms', () => {
    const r = run({ marginPerGreenKg: 18 });
    expect(r.marginPerGreenLb).toBeCloseTo(18 * KG_PER_LB, 9);
  });
});

describe('the floor is a floor', () => {
  it('equals the price when the dial is at zero', () => {
    const r = run({ marginPerGreenKg: 0 });
    expect(r.pricePerUnit).toBeCloseTo(r.costFloorPerUnit as number, 9);
    expect(r.marginPerUnit).toBeCloseTo(0, 9);
  });

  it('means a cent below it loses money', () => {
    const r = run({ marginPerGreenKg: 0 });
    const floor = r.costFloorPerUnit as number;
    expect(floor - 0.01).toBeLessThan(floor);
    // and the engine says so when the dial goes negative
    const under = run({ marginPerGreenKg: -1 });
    expect(under.pricePerUnit as number).toBeLessThan(under.costFloorPerUnit as number);
    expect(under.warnings.some((w) => w.kind === 'NEGATIVE_MARGIN')).toBe(true);
  });

  it('rises when any single input rises', () => {
    const base = run().costFloorPerUnit as number;
    expect(run({ green: { kind: 'FLAT', pricePerKg: 11 } }).costFloorPerUnit as number).toBeGreaterThan(base);
    expect(run({ packagingMaterialPerUnit: 2 }).costFloorPerUnit as number).toBeGreaterThan(base);
  });

  it('excludes overhead entirely — that is handled at business level', () => {
    const r = run();
    expect(r.lines.map((l) => l.key)).not.toContain('overhead');
  });
});

describe('both denominators describe the same line', () => {
  it('reconciles per-unit and per-green-kg through green consumed', () => {
    const r = run();
    const perUnit = r.costFloorPerUnit as number;
    const perGreenKg = r.costFloorPerGreenKg as number;
    expect(perGreenKg * (r.greenKgPerUnit as number)).toBeCloseTo(perUnit, 9);
  });

  it('reconciles price the same way', () => {
    const r = run();
    expect((r.pricePerGreenKg as number) * (r.greenKgPerUnit as number)).toBeCloseTo(
      r.pricePerUnit as number,
      9,
    );
  });

  it('prices toll work per green kg with no unit at all', () => {
    // No bag: gramsPerUnit null, and toll has no per-unit lines.
    const r = run({ tier: 'T2_TOLL', gramsPerUnit: null, packagingMaterialPerUnit: null });
    expect(r.greenKgPerUnit).toBeNull();
    expect(r.costFloorPerUnit).toBeNull();
    // machine 0.20 + roast labour 1.00, no green (client's coffee)
    expect(r.costFloorPerGreenKg).toBeCloseTo(1.2, 9);
    expect(r.pricePerGreenKg).toBeCloseTo(1.2 + 4, 9);
  });

  it('refuses a per-green-kg floor when a per-unit line is on but there is no unit', () => {
    // Packaging charged per unit, but no unit to charge it to: undefined, so null.
    const r = run({
      tier: 'T4_PRIVATE_LABEL',
      gramsPerUnit: null,
      packagingMaterialPerUnit: 1,
    });
    expect(r.costFloorPerUnit).toBeNull();
    expect(r.costFloorPerGreenKg).toBeNull();
  });
});

describe('an incomplete stack has no floor', () => {
  it('returns null rather than a floor missing a cost', () => {
    const r = run({ packagingMaterialPerUnit: null });
    expect(r.costFloorPerUnit).toBeNull();
    expect(r.pricePerUnit).toBeNull();
    expect(r.incomplete).toContain('Packaging material');
  });

  it('names every included line that is unset', () => {
    const bare: PricingAssumptions = {
      ...A,
      machine_running_cost_per_hr: null,
      labour_salary_annual: null,
    };
    const r = calculateLine(line(), bare, BANDS);
    expect(r.incomplete).toEqual(
      expect.arrayContaining(['Roaster running cost', 'Roast labour', 'Pack labour']),
    );
    expect(r.costFloorPerUnit).toBeNull();
  });

  it('ignores an unset input on a line the configuration excludes', () => {
    // Toll: green is off, so a missing green price must not block the floor.
    const r = run({
      tier: 'T2_TOLL',
      green: { kind: 'FLAT', pricePerKg: null },
      gramsPerUnit: null,
      packagingMaterialPerUnit: null,
    });
    expect(r.incomplete).toHaveLength(0);
    expect(r.costFloorPerGreenKg).not.toBeNull();
  });

  it('never reports zero for an excluded line', () => {
    const r = run({ tier: 'T2_TOLL', gramsPerUnit: null, packagingMaterialPerUnit: null });
    const green = lineByKey(r, 'green');
    expect(green.included).toBe(false);
    expect(green.rate).toBeNull();
    expect(green.perUnit).toBeNull();
    expect(green.perGreenKg).toBeNull();
  });
});

describe('every line explains itself', () => {
  it('gives each line arithmetic and a source', () => {
    const r = run();
    for (const l of r.lines.filter((x) => x.included)) {
      expect(l.explanation.length, l.label).toBeGreaterThan(0);
      expect(l.source.length, l.label).toBeGreaterThan(0);
    }
  });

  it('says where an assumption-derived rate came from', () => {
    const r = run();
    expect(lineByKey(r, 'roastLabour').source).toBe('Assumptions');
    expect(lineByKey(r, 'packLabour').source).toContain('weight band');
  });

  it('explains why an excluded line is absent rather than leaving it blank', () => {
    const r = run({ tier: 'T2_TOLL' });
    expect(lineByKey(r, 'green').explanation).toContain('Not included');
  });

  it('reports green consumed with its arithmetic', () => {
    const r = run();
    expect(r.greenKgExplanation).toContain('1,250 g green');
  });
});

describe('blends', () => {
  it('weights green cost across components', () => {
    const b = blendedGreenPricePerKg([
      { label: 'A', pctOfBlend: 70, pricePerKg: 10 },
      { label: 'B', pctOfBlend: 30, pricePerKg: 20 },
    ])!;
    expect(b.value).toBeCloseTo(13, 9);
  });

  it('refuses to weight when a component price is unset', () => {
    expect(
      blendedGreenPricePerKg([
        { label: 'A', pctOfBlend: 70, pricePerKg: 10 },
        { label: 'B', pctOfBlend: 30, pricePerKg: null },
      ]),
    ).toBeNull();
  });

  it('feeds the weighted price into the floor', () => {
    const r = run({
      green: {
        kind: 'BLEND',
        components: [
          { label: 'A', pctOfBlend: 50, pricePerKg: 8 },
          { label: 'B', pctOfBlend: 50, pricePerKg: 12 },
        ],
      },
    });
    expect(lineByKey(r, 'green').rate).toBeCloseTo(10, 9);
  });

  it('totals shares so the caller can check them', () => {
    expect(blendSharesTotal([])).toBe(0);
    expect(
      blendSharesTotal([
        { label: 'A', pctOfBlend: 60, pricePerKg: 8 },
        { label: 'B', pctOfBlend: 40, pricePerKg: 12 },
      ]),
    ).toBe(100);
  });

  it('warns when shares do not total 100', () => {
    const r = run({
      green: {
        kind: 'BLEND',
        components: [
          { label: 'A', pctOfBlend: 50, pricePerKg: 8 },
          { label: 'B', pctOfBlend: 40, pricePerKg: 12 },
        ],
      },
    });
    expect(r.warnings.some((w) => w.kind === 'BLEND_SHARES_NOT_100')).toBe(true);
  });
});

describe('benchmark warning', () => {
  it('stays quiet while green sits below the benchmark', () => {
    const r = run({ green: { kind: 'FLAT', pricePerKg: 7 }, greenBenchmarkPerKg: 8 });
    expect(r.warnings.some((w) => w.kind === 'GREEN_AT_OR_OVER_BENCHMARK')).toBe(false);
  });

  it('fires when green reaches the benchmark', () => {
    const r = run({ green: { kind: 'FLAT', pricePerKg: 8 }, greenBenchmarkPerKg: 8 });
    expect(r.warnings.some((w) => w.kind === 'GREEN_AT_OR_OVER_BENCHMARK')).toBe(true);
  });

  it('fires when green exceeds the benchmark', () => {
    const r = run({ green: { kind: 'FLAT', pricePerKg: 9 }, greenBenchmarkPerKg: 8 });
    expect(r.warnings.some((w) => w.kind === 'GREEN_AT_OR_OVER_BENCHMARK')).toBe(true);
  });

  it('stays quiet when we do not own the green', () => {
    const r = run({
      tier: 'T2_TOLL',
      green: { kind: 'FLAT', pricePerKg: 99 },
      greenBenchmarkPerKg: 8,
      gramsPerUnit: null,
      packagingMaterialPerUnit: null,
    });
    expect(r.warnings.some((w) => w.kind === 'GREEN_AT_OR_OVER_BENCHMARK')).toBe(false);
  });
});

describe('packaging weight bands drive pack labour', () => {
  it('costs a heavier unit more to pack', () => {
    const small = run({ gramsPerUnit: 340 });
    const large = run({ gramsPerUnit: 2000 });
    expect(lineByKey(large, 'packLabour').rate as number).toBeGreaterThan(
      lineByKey(small, 'packLabour').rate as number,
    );
  });

  it('blocks the floor when the matching band has no speed set', () => {
    const unrated = BANDS.map((b) => ({ ...b, units_per_hour: null }));
    const r = calculateLine(line(), A, unrated);
    expect(r.incomplete).toContain('Pack labour');
    expect(r.costFloorPerUnit).toBeNull();
  });
});

describe('volume forecast', () => {
  it('multiplies through to a period', () => {
    const r = run();
    const f = forecast(r, { cadence: 'MONTHLY', unitsPerPeriod: 100 });
    expect(f.marginPerPeriod).toBeCloseTo((r.marginPerUnit as number) * 100, 6);
    expect(f.revenuePerPeriod).toBeCloseTo((r.pricePerUnit as number) * 100, 6);
    expect(f.greenKgPerPeriod).toBeCloseTo(1.25 * 100, 9);
  });

  it('normalises weekly legacy accounts to a monthly equivalent', () => {
    const r = run();
    const weekly = forecast(r, { cadence: 'WEEKLY', unitsPerPeriod: 100 });
    expect(weekly.marginPerMonth).toBeCloseTo(
      (weekly.marginPerPeriod as number) * WEEKS_PER_MONTH,
      6,
    );
  });

  it('leaves a monthly cadence unscaled', () => {
    const r = run();
    const monthly = forecast(r, { cadence: 'MONTHLY', unitsPerPeriod: 100 });
    expect(monthly.marginPerMonth).toBeCloseTo(monthly.marginPerPeriod as number, 9);
  });

  it('returns nulls rather than zeros when volume is unset', () => {
    const f = forecast(run(), { cadence: 'MONTHLY', unitsPerPeriod: null });
    expect(f.marginPerPeriod).toBeNull();
    expect(f.revenuePerPeriod).toBeNull();
    expect(f.marginPerMonth).toBeNull();
  });

  it('cannot forecast revenue from an incomplete stack', () => {
    const r = run({ packagingMaterialPerUnit: null });
    const f = forecast(r, { cadence: 'MONTHLY', unitsPerPeriod: 100 });
    expect(f.revenuePerPeriod).toBeNull();
    // margin per unit is still knowable — it does not depend on the cost lines
    expect(f.marginPerPeriod).not.toBeNull();
  });
});

describe('services', () => {
  it('sums per-unit service charges into the floor', () => {
    const r = run({
      tier: 'T6_WHITE_GLOVE',
      services: [
        { label: 'Fulfilment', amountPerUnit: 0.5 },
        { label: 'Shipping prep', amountPerUnit: 0.25 },
      ],
    });
    expect(lineByKey(r, 'downstreamServices').rate).toBeCloseTo(0.75, 9);
  });

  it('treats an empty service list as zero, not as missing', () => {
    const r = run({ tier: 'T6_WHITE_GLOVE', services: [] });
    expect(lineByKey(r, 'downstreamServices').rate).toBe(0);
    expect(r.incomplete).not.toContain('Downstream services');
  });

  it('blocks the floor when a service has no amount', () => {
    const r = run({
      tier: 'T6_WHITE_GLOVE',
      services: [{ label: 'Fulfilment', amountPerUnit: null }],
    });
    expect(r.incomplete).toContain('Downstream services');
    expect(r.costFloorPerUnit).toBeNull();
  });
});
