import { describe, it, expect } from 'vitest';
import { packLineProgress, remainingPackWeightKg } from './packLineSplit';

describe('case packing quantities', () => {
  it('counts packed cases independently of loose bags', () => {
    const cases = packLineProgress(4, 1);
    const bags = packLineProgress(4, 0);
    expect(cases).toEqual({ packed: 1, needed: 4, complete: false });
    expect(bags).toEqual({ packed: 0, needed: 4, complete: false });
  });
  it('uses the full constituent weight once for each remaining case', () => {
    expect(remainingPackWeightKg([
      { units: 4, packed: 1, bagSizeG: 12 * 250, requiresProduction: true },
      { units: 4, packed: 0, bagSizeG: 250, requiresProduction: true },
    ])).toBe(10);
  });
});