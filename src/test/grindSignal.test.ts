import { describe, it, expect } from 'vitest';
import { parseGrindSignal } from '../../supabase/functions/_shared/grind';

// The pull edge function and the quarantine-resolve RPC both parse the Shopify
// VARIANT TITLE alone (never the product title joined with a "/"). These cases
// use the real FUNK variant titles that exposed the false-positive GRIND bug:
// wholesale variants are a bare size with no grind axis and must NOT flag grind.
describe('parseGrindSignal — variant title only', () => {
  it('wholesale sizes never flag grind', () => {
    for (const size of ['2LB', '250G', '2LB bag', '5LB bag', '200G', '250g']) {
      const r = parseGrindSignal(size);
      expect(r.needsGrind, size).toBe(false);
      expect(r.grindLabel, size).toBeNull();
    }
  });

  it('retail whole-bean variants do not flag grind', () => {
    for (const v of ['250G / Whole Beans', '200G / Whole Beans', '5LB bag / Whole Beans']) {
      expect(parseGrindSignal(v).needsGrind, v).toBe(false);
    }
  });

  it('retail ground variants flag grind with the grind segment as the label', () => {
    expect(parseGrindSignal('250G / French Press')).toEqual({
      needsGrind: true,
      grindLabel: 'French Press',
    });
    expect(parseGrindSignal('2LB bag / Flat Bottom Drip')).toEqual({
      needsGrind: true,
      grindLabel: 'Flat Bottom Drip',
    });
  });

  it('bundle/no-option and empty variants do not flag grind', () => {
    expect(parseGrindSignal('Default Title').needsGrind).toBe(false);
    expect(parseGrindSignal('').needsGrind).toBe(false);
    expect(parseGrindSignal(null).needsGrind).toBe(false);
  });
});
