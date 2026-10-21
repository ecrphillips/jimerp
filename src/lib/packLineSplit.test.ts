import { describe, it, expect } from 'vitest';
import { splitPackLine, packLineProgress, remainingPackWeightKg } from './packLineSplit';

describe('separate ground packing lines', () => {
  it('counts each bag once across whole bean and individual grind types', () => {
    const rows = splitPackLine({ units: 6, wholeBeanUnits: 3, grindUnits: 3, grindByLabel: { 'French Press': 1, Drip: 2 } });
    expect(rows.map(r => [r.grindLabel, r.units])).toEqual([[null, 3], ['French Press', 1], ['Drip', 2]]);
    expect(rows.reduce((sum, row) => sum + row.units, 0)).toBe(6);
  });
  it('finishing whole bean does not finish the ground line', () => {
    expect(packLineProgress(3, 3).complete).toBe(true);
    expect(packLineProgress(1, 0)).toEqual({ packed: 0, needed: 1, complete: false });
  });
  it('partial completion leaves only the remaining bags to pack', () => {
    expect(packLineProgress(9, 8)).toEqual({ packed: 8, needed: 9, complete: false });
  });
  it('totals only the weight still to pack, excluding finished and bought-in lines', () => {
    expect(remainingPackWeightKg([
      { units: 9, packed: 8, bagSizeG: 1000, requiresProduction: true },
      { units: 4, packed: 2, bagSizeG: 250, requiresProduction: true },
      { units: 3, packed: 3, bagSizeG: 2000, requiresProduction: true },
      { units: 5, packed: 0, bagSizeG: 1000, requiresProduction: false },
    ])).toBe(1.5);
  });
});