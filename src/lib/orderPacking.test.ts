import { describe, it, expect } from 'vitest';
import { addPacked, heldForOthers, picksIntoHeldStock } from './orderPacking';

describe('order packing holds', () => {
  it('Tuesday picking 10 with 38 on shelf all held for the big order dips 10 into held stock', () => {
    expect(picksIntoHeldStock(10, 38, 38)).toBe(10);
  });
  it('no warning when free stock covers the pick', () => {
    expect(picksIntoHeldStock(10, 50, 38)).toBe(0);
  });
  it('excludes the line being picked from holds', () => {
    const holds = [
      { order_line_item_id: 'big', order_id: 'o1', order_number: 'FUNK-1', product_id: 'a', held_units: 38 },
      { order_line_item_id: 'tue', order_id: 'o2', order_number: 'X-2', product_id: 'a', held_units: 4 },
    ];
    expect(heldForOthers(holds, 'a', 'tue').map(h => h.order_line_item_id)).toEqual(['big']);
  });
  it('additive packing clamps to needed and never below picked', () => {
    expect(addPacked(38, 50, 0, 250)).toBe(88);
    expect(addPacked(240, 50, 0, 250)).toBe(250);
    expect(addPacked(10, -20, 5, 250)).toBe(5);
  });
});
