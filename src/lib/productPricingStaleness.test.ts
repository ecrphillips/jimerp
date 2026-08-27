import { describe, it, expect } from 'vitest';
import {
  isRateStale,
  staleFields,
  isStale,
  RATE_EPSILON,
  type PricedSnapshot,
} from './productPricingStaleness';
import type { PricingAssumptions } from './pricingAssumptions';

// 100000 / (50 * 40) = $50/hr base, +0% oncosts = $50/hr loaded.
const A: PricingAssumptions = {
  roast_throughput_green_kg_per_hr: 50,
  machine_running_cost_per_hr: 10,
  labour_salary_annual: 100000,
  labour_weeks_per_year: 50,
  labour_hours_per_week: 40,
  labour_oncost_pct: 0,
  standard_yield_loss_pct: 17,
  green_financing_days: 60,
  green_financing_apr_pct: 12,
};

const priced = (over: Partial<PricedSnapshot> = {}): PricedSnapshot => ({
  assumed_loaded_labour_rate_per_hr: 50,
  assumed_yield_loss_pct: 17,
  assumed_roast_throughput_green_kg_per_hr: 50,
  assumed_machine_running_cost_per_hr: 10,
  ...over,
});

describe('the workflow this exists for', () => {
  it('finds a product priced on $50/hr after the rate moves to $52', () => {
    // Salary bumped so the derived loaded rate becomes $52/hr.
    const bumped: PricingAssumptions = { ...A, labour_salary_annual: 104000 };
    expect(staleFields(priced(), bumped)).toContain('labour');
  });

  it('leaves a product alone when it was priced on the current rate', () => {
    expect(staleFields(priced(), A)).toEqual([]);
    expect(isStale(priced(), A)).toBe(false);
  });

  it('accounts for oncosts when comparing — the loaded rate is what was used', () => {
    // Base stays $50 but oncosts take the loaded rate to $55.
    const withOncosts: PricingAssumptions = { ...A, labour_oncost_pct: 10 };
    expect(staleFields(priced({ assumed_loaded_labour_rate_per_hr: 50 }), withOncosts)).toContain(
      'labour',
    );
    expect(staleFields(priced({ assumed_loaded_labour_rate_per_hr: 55 }), withOncosts)).toEqual([]);
  });
});

describe('every snapshotted assumption is checked', () => {
  it('flags a changed yield loss', () => {
    expect(staleFields(priced(), { ...A, standard_yield_loss_pct: 14 })).toContain('yield');
  });

  it('flags a changed throughput', () => {
    expect(staleFields(priced(), { ...A, roast_throughput_green_kg_per_hr: 45 })).toContain(
      'throughput',
    );
  });

  it('flags a changed machine running cost', () => {
    expect(staleFields(priced(), { ...A, machine_running_cost_per_hr: 7.5 })).toContain('machine');
  });

  it('reports several at once rather than stopping at the first', () => {
    const moved: PricingAssumptions = {
      ...A,
      standard_yield_loss_pct: 14,
      roast_throughput_green_kg_per_hr: 45,
    };
    expect(staleFields(priced(), moved).sort()).toEqual(['throughput', 'yield']);
  });
});

describe('what does not count as staleness', () => {
  it('ignores a rate that was never captured', () => {
    expect(isRateStale(null, 52)).toBe(false);
    expect(staleFields(priced({ assumed_loaded_labour_rate_per_hr: null }), A)).toEqual([]);
  });

  it('ignores an assumption that is not currently set', () => {
    // An unset rate is a different problem; reporting it here would bury the
    // real drift in noise.
    expect(isRateStale(50, null)).toBe(false);
    expect(staleFields(priced(), { ...A, standard_yield_loss_pct: null })).toEqual([]);
  });

  it('tolerates float noise below the epsilon', () => {
    expect(isRateStale(50, 50 + RATE_EPSILON / 2)).toBe(false);
    expect(isRateStale(50, 50 + RATE_EPSILON * 2)).toBe(true);
  });

  it('detects a drop as readily as a rise', () => {
    expect(isRateStale(52, 50)).toBe(true);
    expect(isRateStale(50, 52)).toBe(true);
  });
});
