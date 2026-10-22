import { describe, it, expect } from 'vitest';
import { basketValue, roastGroupGreenValue, sourcesPctIsOff, weightedAverage } from './greenSources';

const lot = (id: string, market: number | null, book: number | null = market) => ({
  id, lot_number: id, market_value_per_kg: market, book_value_per_kg: book,
});

describe('weightedAverage', () => {
  it('weights by % and ignores unpriced rows', () => {
    const r = weightedAverage([
      { pct: 75, marketPerKg: 10, bookPerKg: 8 },
      { pct: 25, marketPerKg: 20, bookPerKg: 16 },
      { pct: 50, marketPerKg: null, bookPerKg: null },
    ]);
    expect(r.marketPerKg).toBeCloseTo(12.5);
    expect(r.bookPerKg).toBeCloseTo(10);
    expect(r.lines.map(l => l.weight)).toEqual([0.75, 0.25, 0]);
  });

  it('uses equal weights when no % is set (same as the old lot-only rule)', () => {
    const r = weightedAverage([
      { pct: null, marketPerKg: 10, bookPerKg: 10 },
      { pct: null, marketPerKg: 20, bookPerKg: 20 },
    ]);
    expect(r.marketPerKg).toBe(15);
  });

  it('returns null with nothing priced', () => {
    expect(weightedAverage([{ pct: 100, marketPerKg: null, bookPerKg: null }]).marketPerKg).toBeNull();
  });
});

describe('basketValue', () => {
  it('uses only active lots, weighted by active %', () => {
    const v = basketValue([
      { active_pct: 60, lot: lot('a', 10) },
      { active_pct: 40, lot: lot('b', 15) },
      { active_pct: null, lot: lot('lined-up', 100) },
    ]);
    expect(v.marketPerKg).toBeCloseTo(12);
    expect(v.lines).toHaveLength(2);
  });

  it('falls back to book value when market is missing', () => {
    expect(basketValue([{ active_pct: 100, lot: lot('a', null, 9) }]).marketPerKg).toBe(9);
  });
});

describe('roastGroupGreenValue', () => {
  it('matches the old result when there are only linked lots', () => {
    const r = roastGroupGreenValue([{ pct_of_lot: null, lot: lot('a', 10) }, { pct_of_lot: null, lot: lot('b', 12) }], []);
    expect(r.marketPerKg).toBe(11);
  });

  it('mixes a basket and a lot by their %', () => {
    const r = roastGroupGreenValue(
      [{ pct_of_lot: 30, lot: lot('special', 20) }],
      [{ pct: 70, basket: { id: 'br', name: 'Brazil', members: [{ active_pct: 100, lot: lot('bra1', 10) }] } }],
    );
    expect(r.marketPerKg).toBeCloseTo(13);
    const basketLine = r.lines.find(l => l.kind === 'BASKET')!;
    expect(basketLine.label).toBe('Brazil');
    expect(basketLine.basketLines?.[0].lot.lot_number).toBe('bra1');
  });

  it('skips a basket with no active priced lots', () => {
    const r = roastGroupGreenValue(
      [{ pct_of_lot: null, lot: lot('a', 10) }],
      [{ pct: null, basket: { id: 'x', name: 'Empty', members: [] } }],
    );
    expect(r.marketPerKg).toBe(10);
    expect(r.usableCount).toBe(1);
  });
});

describe('sourcesPctIsOff', () => {
  it('only warns when some % is entered and the total is not 100', () => {
    expect(sourcesPctIsOff([null, null])).toBe(false);
    expect(sourcesPctIsOff([70, 30])).toBe(false);
    expect(sourcesPctIsOff([70, null])).toBe(true);
  });
});
