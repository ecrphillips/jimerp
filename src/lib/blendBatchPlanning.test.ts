import { describe, expect, it } from 'vitest';
import { planBlendBatches, wholeBatchRecipe, canUseBlendAmounts } from './blendBatchPlanning';

const components = [25, 25, 50].map((pct, i) => ({ roastGroup: String(i), pct, outputPerBatchKg: 6.72, availableKg: 6.72, batchCount: 1 }));
describe('whole-batch blend planning', () => {
  it('targets 1/1/2 for 25/25/50 and does not cover with 1/1/1', () => {
    const plan = planBlendBatches(components, 10);
    expect(plan.rows.map(r => r.targetCount)).toEqual([1, 1, 2]);
    expect(plan.rows.map(r => r.additionalBatches)).toEqual([0, 0, 1]);
    expect(plan.covered).toBe(false);
    expect(plan.targetKg).toBeCloseTo(26.88);
  });
  it('covers a whole recipe set with 1/1/2', () => {
    expect(planBlendBatches(components.map((c, i) => i === 2 ? { ...c, batchCount: 2, availableKg: 13.44 } : c), 10).covered).toBe(true);
  });
  it('allows demand-only coverage at 1/1/1 only with the partial exception', () => {
    const plan = planBlendBatches(components, 10, true);
    expect(plan.covered).toBe(true);
    expect(plan.rows.map(r => r.additionalBatches)).toEqual([0, 0, 0]);
  });
  it('accounts for unequal batch sizes and yields', () => {
    expect(wholeBatchRecipe([{ ...components[0], pct: 50, outputPerBatchKg: 6.72 }, { ...components[1], pct: 50, outputPerBatchKg: 16.8 }])).toEqual([5, 2]);
  });
  it('keeps single-coffee 100% blends valid', () => {
    expect(planBlendBatches([{ ...components[0], pct: 100, batchCount: 0 }], 5).rows[0].additionalBatches).toBe(1);
  });
  it('requires explicit permission to consume a partial batch', () => {
    expect(canUseBlendAmounts([{ consumeKg: 3.36, availableKg: 6.72 }], false)).toBe(false);
    expect(canUseBlendAmounts([{ consumeKg: 3.36, availableKg: 6.72 }], true)).toBe(true);
    expect(canUseBlendAmounts([{ consumeKg: 6.72, availableKg: 6.72 }], false)).toBe(true);
  });
});