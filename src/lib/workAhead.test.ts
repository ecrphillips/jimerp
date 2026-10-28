import { describe, it, expect } from 'vitest';
import { classifyWorkAhead } from './workAhead';

describe('classifyWorkAhead', () => {
  it('keeps batches needed for demand and marks surplus batches as work ahead', () => {
    const ahead = classifyWorkAhead(
      [{ id: 'a', expectedOutputKg: 6.72 }, { id: 'b', expectedOutputKg: 6.72 }, { id: 'c', expectedOutputKg: 6.72 }],
      10,
    );
    expect([...ahead]).toEqual(['c']);
  });

  it('marks every planned batch as work ahead when demand is already covered', () => {
    expect(classifyWorkAhead([{ id: 'a', expectedOutputKg: 6.72 }], 0).has('a')).toBe(true);
  });

  it('a batch that only partly covers the remaining need is still needed today', () => {
    expect(classifyWorkAhead([{ id: 'a', expectedOutputKg: 6.72 }], 1).size).toBe(0);
  });
});
