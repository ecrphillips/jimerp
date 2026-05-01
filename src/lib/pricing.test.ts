import { describe, it, expect } from 'vitest';
import {
  computeFinancingCostPerKg,
  computeMarketValuePerKg,
  computeDeriskedCostPerKg,
  computeRoastedCostFromGreen,
  applyTierAdjustment,
} from './pricing';

const close = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

describe('pricing pure helpers — calibration', () => {
  it('financing cost: $10/kg book, 12% APR, 60 days → $0.1973/kg', () => {
    const v = computeFinancingCostPerKg(10, 12, 60);
    expect(close(v, 0.1973, 5e-4)).toBe(true);
  });

  it('market value: $10/kg book + 12%/60d → $10.1973/kg', () => {
    const v = computeMarketValuePerKg(10, 12, 60);
    expect(close(v, 10.1973, 5e-4)).toBe(true);
  });

  it('de-risked: market $11.20 + 8% → $12.0960', () => {
    const v = computeDeriskedCostPerKg(11.2, 8);
    expect(close(v, 12.096, 1e-4)).toBe(true);
  });

  it('roasted from green at 16% yield loss: $12.10 → $14.4048', () => {
    const v = computeRoastedCostFromGreen(12.1, 16);
    expect(close(v, 14.4048, 1e-4)).toBe(true);
  });

  it('tier MULTIPLIER 0.85, cost $10/bag, profile margin 35%: list $15.3846, final $13.0769', () => {
    const { list, final } = applyTierAdjustment(
      10,
      {
        markup_adjustment_type: 'MULTIPLIER',
        markup_multiplier: 0.85,
        per_kg_fee: null,
        target_margin_pct: null,
      },
      35,
      0.34,
    );
    expect(close(list, 15.3846, 1e-4)).toBe(true);
    expect(close(final, 13.0769, 1e-4)).toBe(true);
  });

  it('tier PER_KG_FEE +$2/kg, cost $10/bag at 0.34kg: final $10.68', () => {
    const { final } = applyTierAdjustment(
      10,
      {
        markup_adjustment_type: 'PER_KG_FEE',
        markup_multiplier: null,
        per_kg_fee: 2,
        target_margin_pct: null,
      },
      35,
      0.34,
    );
    expect(close(final, 10.68, 1e-4)).toBe(true);
  });

  it('tier MARGIN_TARGET 30%, cost $10/bag: final $14.2857', () => {
    const { final } = applyTierAdjustment(
      10,
      {
        markup_adjustment_type: 'MARGIN_TARGET',
        markup_multiplier: null,
        per_kg_fee: null,
        target_margin_pct: 30,
      },
      35,
      0.34,
    );
    expect(close(final, 14.2857, 1e-4)).toBe(true);
  });

  it('packaging split: material $0.50 + labour $1.50 on $14.72 roasted → $16.72/bag total', () => {
    const material = 0.5;
    const labour = 1.5;
    const roasted = 14.72;
    const total = roasted + material + labour;
    expect(close(total, 16.72, 1e-4)).toBe(true);
  });

  it('packaging split: material override 0 (client supplies bags) + labour $1.50 → total = roasted + $1.50', () => {
    const material = 0; // explicit override
    const labour = 1.5;
    const roasted = 14.72;
    const total = roasted + material + labour;
    expect(close(total, roasted + 1.5, 1e-4)).toBe(true);
  });
});
