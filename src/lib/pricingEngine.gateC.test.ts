import { describe, it, expect } from 'vitest';
import { calculateLine, type PricingLineInput } from './pricingEngine';
import type { PricingAssumptions, PackSpeedBand } from './pricingAssumptions';

/**
 * Gate C — the engine checked against a price the operator already knew.
 *
 * Every other test in this suite proves the engine is internally consistent.
 * This one proves it is *correct*, by reproducing a real product priced in the
 * app and saved to product_pricing on 27 Aug 2026: Love Hospital Espresso 300g
 * Retail, co-packing, which returned the expected price.
 *
 * The values below are the saved snapshot verbatim. If a refactor moves any of
 * these numbers it has moved a price that was quoted, so this test failing is a
 * signal to stop rather than to update the expectation.
 */

// Assumptions in force at pricing time, from the saved snapshot.
const ASSUMPTIONS: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 45,
  machine_running_cost_per_hr: 10,
  // Derives the loaded rate the snapshot recorded:
  //   75000 / (49 x 37.5) = $40.8163/hr, +10% oncosts = $44.89795918367347/hr
  labour_salary_annual: 75000,
  labour_weeks_per_year: 49,
  labour_hours_per_week: 37.5,
  labour_oncost_pct: 10,
  standard_yield_loss_pct: 17,
  green_financing_days: 30,
  green_financing_apr_pct: 15,
};

// The bands as configured in the app. 300g lands in the first, at 60 units/hr.
const BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g (1 lb)', min_g: 0, max_g: 454, units_per_hour: 60, display_order: 1 },
  { id: '2', label: '455g - 1135g (2.5 lb)', min_g: 455, max_g: 1135, units_per_hour: 45, display_order: 2 },
  { id: '3', label: '1136g - 2270g (5 lb)', min_g: 1136, max_g: 2270, units_per_hour: 30, display_order: 3 },
  { id: '4', label: 'Over 2270g', min_g: 2271, max_g: null, units_per_hour: 20, display_order: 4 },
];

const LOVE_HOSPITAL_300G: PricingLineInput = {
  tier: 'T5_CO_PACK',
  green: { kind: 'FLAT', pricePerKg: null }, // priced on the benchmark
  greenBenchmarkPerKg: 18,
  gramsPerUnit: 300,
  packagingMaterialPerUnit: 0,
  marginPerGreenKg: 11.5743, // $5.25 per green lb
};

const run = () => calculateLine(LOVE_HOSPITAL_300G, ASSUMPTIONS, BANDS);

describe('Gate C — Love Hospital Espresso 300g Retail, co-packing', () => {
  it('derives the loaded labour rate the snapshot recorded', () => {
    // Guards the fixture itself: if this drifts, the rest of the test is
    // reproducing something other than what was actually priced.
    const r = run();
    const roastLabour = r.lines.find((l) => l.key === 'roastLabour')!;
    expect((roastLabour.rate as number) * 45).toBeCloseTo(44.89795918367347, 10);
  });

  it('consumes 0.36144578 green kg per 300g unit', () => {
    expect(run().greenKgPerUnit).toBeCloseTo(0.3614457831325301, 12);
  });

  it('prices green on the benchmark, not the market value', () => {
    expect(run().lines.find((l) => l.key === 'green')!.rate).toBe(18);
  });

  it('builds each cost line to the cent', () => {
    const r = run();
    const rate = (k: string) => r.lines.find((l) => l.key === k)!.perUnit as number;

    expect(rate('green')).toBeCloseTo(6.506024096385542, 10);
    expect(rate('roasterRunning')).toBeCloseTo(0.08032128514056225, 10);
    // 44.89795918367347/45 = 0.9977324263038549 per green kg, x 0.3614457831325301
    expect(rate('roastLabour')).toBeCloseTo(0.3606261781821162, 10);
    expect(rate('packLabour')).toBeCloseTo(0.7482993197278912, 10);
  });

  it('reaches the cost floor the app saved', () => {
    expect(run().costFloorPerUnit).toBeCloseTo(7.695270879436111, 10);
  });

  it('reaches the price the app saved — $11.88 for a 300g bag', () => {
    const r = run();
    expect(r.pricePerUnit).toBeCloseTo(11.878752807146954, 10);
    expect((r.pricePerUnit as number).toFixed(2)).toBe('11.88');
  });

  it('states the margin dial in pounds as it was entered', () => {
    expect(run().marginPerGreenLb).toBeCloseTo(5.25, 4);
  });

  it('flags the packaging line charged at zero', () => {
    // The saved row has packaging switched on at $0.00, which prices the bag as
    // though it were free. Zero is a legitimate value, so the engine cannot
    // infer intent — it warns instead.
    const r = run();
    expect(r.warnings.some((w) => w.kind === 'ZERO_COST_LINE')).toBe(true);
  });

  it('flags a benchmark with nothing to compare against', () => {
    // green_market_per_kg was null, so no warning could ever fire on this
    // product however far green moved.
    const r = run();
    expect(r.warnings.some((w) => w.kind === 'NO_MARKET_VALUE_TO_COMPARE')).toBe(true);
  });

  it('still produces a floor despite both warnings', () => {
    // Warnings inform; they do not block. An incomplete stack is what blocks.
    expect(run().incomplete).toEqual([]);
    expect(run().costFloorPerUnit).not.toBeNull();
  });
});
