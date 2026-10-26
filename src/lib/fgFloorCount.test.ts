import { describe, expect, it } from 'vitest';
import { fgFloorCountDelta } from './fgFloorCount';
import { computeAuthoritativeFg } from '@/hooks/useAuthoritativeInventory';

describe('FG physical floor count', () => {
  it('sets the count despite a hidden negative ledger balance (Spellbound regression)', () => {
    const before = [
      { product_id: 'spellbound', transaction_type: 'PACK_PRODUCE_FG', quantity_units: 112 },
      { product_id: 'spellbound', transaction_type: 'SHIP_CONSUME_FG', quantity_units: -101 },
      { product_id: 'spellbound', transaction_type: 'ADJUSTMENT', quantity_units: -2048 },
    ];
    expect(computeAuthoritativeFg(before).spellbound.fg_available_units).toBe(0);
    const delta = fgFloorCountDelta(23, -2037);
    expect(delta).toBe(2060);
    expect(computeAuthoritativeFg([...before, {
      product_id: 'spellbound', transaction_type: 'ADJUSTMENT', quantity_units: delta,
    }]).spellbound.fg_available_units).toBe(23);
  });

  it('balances positive stock and allows a count of zero', () => {
    expect(fgFloorCountDelta(12, 5)).toBe(7);
    expect(fgFloorCountDelta(0, 5)).toBe(-5);
    expect(fgFloorCountDelta(5, 5)).toBe(0);
  });

  it('rejects fractional or negative physical counts', () => {
    expect(() => fgFloorCountDelta(-1, 0)).toThrow();
    expect(() => fgFloorCountDelta(1.5, 0)).toThrow();
  });
});