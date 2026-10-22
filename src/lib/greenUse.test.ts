import { describe, it, expect } from 'vitest';
import { defaultLotSplits, greenFactor, greenKgForRoasted, splitKg } from './greenUse';
import type { RoastGroupBasketLots } from '@/hooks/roastGroupBasketLots';
import type { BasketLotInfo } from '@/lib/baskets';

const lot = (id: string): BasketLotInfo => ({
  id, lot_number: id, status: 'RECEIVED', received_date: '2026-09-01', expected_delivery_date: null,
  is_placeholder: false, kg_on_hand: 300, bags_released: 5, bag_size_kg: 60,
  estimated_days_to_consume: null, created_at: '2026-08-01T00:00:00Z',
});

const basket = (name: string, rgPct: number | null, active: [string, number][]): RoastGroupBasketLots => ({
  rgbId: `rgb-${name}`, roastGroup: 'RG', basket: { id: name, name }, rgPct,
  active: active.map(([id, pct]) => ({ lot: lot(id), activePct: pct })), linedUp: [],
});

describe('greenKgForRoasted', () => {
  it('grosses roasted kg up by the roast loss', () => {
    expect(greenKgForRoasted(20, 15)).toBeCloseTo(23.53, 2);
    expect(greenFactor(null)).toBe(1);
    expect(greenFactor(100)).toBe(1);
  });
});

describe('defaultLotSplits', () => {
  it('gives a single linked lot 100%', () => {
    expect(defaultLotSplits([{ lot_id: 'a', lot_number: 'A', pct_of_lot: null }], [])).toEqual([
      { lot_id: 'a', lot_number: 'A', pct: 100, via_basket: null },
    ]);
  });

  it('splits two baskets by their % and each basket by active %', () => {
    const s = defaultLotSplits([], [basket('Brazil', 60, [['b1', 50], ['b2', 50]]), basket('Guatemala', 40, [['g1', 100]])]);
    const byId = Object.fromEntries(s.map(x => [x.lot_id, x.pct]));
    expect(byId.b1).toBeCloseTo(30);
    expect(byId.b2).toBeCloseTo(30);
    expect(byId.g1).toBeCloseTo(40);
    expect(s.find(x => x.lot_id === 'g1')?.via_basket).toBe('Guatemala');
  });

  it('weights sources equally when no % is set, and skips baskets with no active lot', () => {
    const s = defaultLotSplits([{ lot_id: 'a', lot_number: 'A', pct_of_lot: null }], [basket('Brazil', null, [['b1', 100]]), basket('Empty', null, [])]);
    expect(s.map(x => Math.round(x.pct))).toEqual([50, 50]);
  });

  it('is empty with no sources', () => {
    expect(defaultLotSplits([], [])).toEqual([]);
  });
});

describe('splitKg', () => {
  it('scales shares to cover the whole batch, like the database', () => {
    const kg = splitKg([{ lot_id: 'a', pct: 60 }, { lot_id: 'b', pct: 20 }], 40);
    expect(kg.get('a')).toBeCloseTo(30);
    expect(kg.get('b')).toBeCloseTo(10);
  });
});
