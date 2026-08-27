import { describe, it, expect } from 'vitest';
import {
  deriveBaseLabourRate,
  deriveLoadedLabourRate,
  deriveMachineCostPerGreenKg,
  deriveRoastLabourPerGreenKg,
  findPackSpeedBand,
  derivePackLabourPerUnit,
  deriveGreenKgConsumed,
  perKgToPerLb,
  perLbToPerKg,
  validateBandCoverage,
  type PricingAssumptions,
  type PackSpeedBand,
} from './pricingAssumptions';

const EMPTY: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: null,
  machine_running_cost_per_hr: null,
  labour_salary_annual: null,
  labour_weeks_per_year: null,
  labour_hours_per_week: null,
  labour_oncost_pct: null,
  standard_yield_loss_pct: null,
  green_financing_days: null,
  green_financing_apr_pct: null,
};

// Illustrative figures only — these are not the operator's real rates.
const FILLED: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 45,
  machine_running_cost_per_hr: 7.5,
  labour_salary_annual: 75000,
  labour_weeks_per_year: 49,
  labour_hours_per_week: 37.5,
  labour_oncost_pct: 10,
  standard_yield_loss_pct: 17,
  green_financing_days: 60,
  green_financing_apr_pct: 12,
};

const BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g (1 lb)', min_g: 0, max_g: 454, units_per_hour: 120, display_order: 1 },
  { id: '2', label: '455g - 1135g (2.5 lb)', min_g: 455, max_g: 1135, units_per_hour: 60, display_order: 2 },
  { id: '3', label: '1136g - 2270g (5 lb)', min_g: 1136, max_g: 2270, units_per_hour: 40, display_order: 3 },
  { id: '4', label: 'Over 2270g', min_g: 2271, max_g: null, units_per_hour: 25, display_order: 4 },
];

describe('null-propagation — unset rates never become zero', () => {
  it('returns null for every derivation when nothing is set', () => {
    expect(deriveBaseLabourRate(EMPTY)).toBeNull();
    expect(deriveLoadedLabourRate(EMPTY)).toBeNull();
    expect(deriveMachineCostPerGreenKg(EMPTY)).toBeNull();
    expect(deriveRoastLabourPerGreenKg(EMPTY)).toBeNull();
    expect(deriveGreenKgConsumed(EMPTY, 340)).toBeNull();
    expect(derivePackLabourPerUnit(EMPTY, BANDS, 340)).toBeNull();
  });

  it('returns null when only some labour inputs are set', () => {
    expect(deriveBaseLabourRate({ ...EMPTY, labour_salary_annual: 75000 })).toBeNull();
    expect(
      deriveBaseLabourRate({ ...EMPTY, labour_salary_annual: 75000, labour_weeks_per_year: 49 }),
    ).toBeNull();
  });

  it('returns null for loaded rate when oncost is unset even if base derives', () => {
    const noOncost = { ...FILLED, labour_oncost_pct: null };
    expect(deriveBaseLabourRate(noOncost)).not.toBeNull();
    expect(deriveLoadedLabourRate(noOncost)).toBeNull();
  });

  it('returns null when a band exists but its rate is unset', () => {
    const unratedBands = BANDS.map((b) => ({ ...b, units_per_hour: null }));
    expect(findPackSpeedBand(unratedBands, 340)).not.toBeNull();
    expect(derivePackLabourPerUnit(FILLED, unratedBands, 340)).toBeNull();
  });
});

describe('labour rate derivation', () => {
  it('derives base rate from salary, weeks and hours', () => {
    const r = deriveBaseLabourRate(FILLED)!;
    // 75000 / (49 * 37.5) = 75000 / 1837.5
    expect(r.value).toBeCloseTo(40.8163, 4);
  });

  it('applies oncosts on top of the base rate', () => {
    const r = deriveLoadedLabourRate(FILLED)!;
    expect(r.value).toBeCloseTo(40.8163 * 1.1, 4);
  });

  it('explains its arithmetic rather than just returning a number', () => {
    const r = deriveLoadedLabourRate(FILLED)!;
    expect(r.explanation).toContain('75,000');
    expect(r.explanation).toContain('49');
    expect(r.explanation).toContain('37.5');
    expect(r.explanation).toContain('10%');
  });

  it('rejects zero or negative weeks and hours', () => {
    expect(deriveBaseLabourRate({ ...FILLED, labour_weeks_per_year: 0 })).toBeNull();
    expect(deriveBaseLabourRate({ ...FILLED, labour_hours_per_week: 0 })).toBeNull();
  });
});

describe('per-green-kg conversions', () => {
  it('converts machine hourly cost to per green kg', () => {
    const r = deriveMachineCostPerGreenKg(FILLED)!;
    expect(r.value).toBeCloseTo(7.5 / 45, 6); // 0.1667
  });

  it('converts loaded labour to per green kg using the same throughput', () => {
    const loaded = deriveLoadedLabourRate(FILLED)!.value;
    const r = deriveRoastLabourPerGreenKg(FILLED)!;
    expect(r.value).toBeCloseTo(loaded / 45, 6);
  });

  it('returns null when throughput is unset', () => {
    const noTput = { ...FILLED, roast_throughput_green_kg_per_hr: null };
    expect(deriveMachineCostPerGreenKg(noTput)).toBeNull();
    expect(deriveRoastLabourPerGreenKg(noTput)).toBeNull();
  });
});

describe('green consumed', () => {
  it('applies yield loss to convert roasted grams to green kg', () => {
    const r = deriveGreenKgConsumed(FILLED, 340)!;
    // 0.34 / (1 - 0.17) = 0.409639
    expect(r.value).toBeCloseTo(0.409639, 6);
  });

  it('consumes exactly the roasted weight when yield loss is zero', () => {
    const r = deriveGreenKgConsumed({ ...FILLED, standard_yield_loss_pct: 0 }, 1000)!;
    expect(r.value).toBeCloseTo(1, 9);
  });

  it('rejects a 100% yield loss rather than dividing by zero', () => {
    expect(deriveGreenKgConsumed({ ...FILLED, standard_yield_loss_pct: 100 }, 340)).toBeNull();
  });

  it('scales linearly with bag size', () => {
    const small = deriveGreenKgConsumed(FILLED, 250)!.value;
    const large = deriveGreenKgConsumed(FILLED, 500)!.value;
    expect(large).toBeCloseTo(small * 2, 9);
  });
});

describe('pack speed bands', () => {
  it.each([
    [125, 'Up to 454g (1 lb)'],
    [250, 'Up to 454g (1 lb)'],
    [340, 'Up to 454g (1 lb)'],
    [400, 'Up to 454g (1 lb)'],
    [454, 'Up to 454g (1 lb)'],
    [455, '455g - 1135g (2.5 lb)'],
    [907, '455g - 1135g (2.5 lb)'],
    [1000, '455g - 1135g (2.5 lb)'],
    [1135, '455g - 1135g (2.5 lb)'],
    [1136, '1136g - 2270g (5 lb)'],
    [2000, '1136g - 2270g (5 lb)'],
    [2268, '1136g - 2270g (5 lb)'],
    [2270, '1136g - 2270g (5 lb)'],
    [2271, 'Over 2270g'],
    [5000, 'Over 2270g'],
  ])('puts %ig in "%s"', (grams, label) => {
    expect(findPackSpeedBand(BANDS, grams)?.label).toBe(label);
  });

  it('covers every existing packaging variant weight', () => {
    const variantWeights = [125, 200, 250, 250, 300, 340, 454, 907, 1000, 2000, 2268];
    for (const g of variantWeights) {
      expect(findPackSpeedBand(BANDS, g), `${g}g matched no band`).not.toBeNull();
    }
  });

  it('rejects non-positive weights', () => {
    expect(findPackSpeedBand(BANDS, 0)).toBeNull();
    expect(findPackSpeedBand(BANDS, -1)).toBeNull();
  });

  it('costs a heavier band more per unit at the same labour rate', () => {
    const retail = derivePackLabourPerUnit(FILLED, BANDS, 340)!.value;
    const bulk = derivePackLabourPerUnit(FILLED, BANDS, 2268)!.value;
    expect(bulk).toBeGreaterThan(retail);
    expect(retail).toBeCloseTo(deriveLoadedLabourRate(FILLED)!.value / 120, 6);
  });
});

describe('band coverage validation', () => {
  it('accepts the seeded bands as a clean tiling', () => {
    expect(validateBandCoverage(BANDS)).toEqual([]);
  });

  it('detects a gap between bands', () => {
    const gapped = [
      { ...BANDS[0], max_g: 454 },
      { ...BANDS[1], min_g: 500 },
      BANDS[2],
      BANDS[3],
    ];
    const problems = validateBandCoverage(gapped);
    expect(problems.some((p) => p.kind === 'gap')).toBe(true);
  });

  it('detects an overlap between bands', () => {
    const overlapped = [
      { ...BANDS[0], max_g: 600 },
      BANDS[1],
      BANDS[2],
      BANDS[3],
    ];
    const problems = validateBandCoverage(overlapped);
    expect(problems.some((p) => p.kind === 'overlap')).toBe(true);
  });

  it('flags a missing open-ended top band', () => {
    const bounded = [BANDS[0], BANDS[1], BANDS[2], { ...BANDS[3], max_g: 5000 }];
    const problems = validateBandCoverage(bounded);
    expect(problems.some((p) => p.kind === 'unbounded-missing')).toBe(true);
  });

  it('treats an empty band list as no problems to report', () => {
    expect(validateBandCoverage([])).toEqual([]);
  });
});

describe('kg <-> lb reference conversion', () => {
  it('round-trips without drift', () => {
    expect(perLbToPerKg(perKgToPerLb(18))).toBeCloseTo(18, 9);
  });

  it('makes a per-lb figure smaller than the per-kg figure it came from', () => {
    // $18/green kg is about $8.16/green lb
    expect(perKgToPerLb(18)).toBeCloseTo(8.1647, 4);
  });
});
