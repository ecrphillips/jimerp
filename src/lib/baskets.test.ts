import { describe, it, expect, vi } from 'vitest';

// baskets.ts reuses DEPLETION_THRESHOLD from the depletion hook, which imports
// the Supabase client. Stub the client so the pure logic loads in tests.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  activePctIsOff,
  activePctTotal,
  buildBasketView,
  compareLinedUp,
  computeVolumes,
  defaultPromotePct,
  isLotReceived,
  isLotRunningLow,
  lotSupplyGroup,
  originCodeFromText,
  type BasketLotInfo,
  type BasketLotRow,
  type BasketRow,
} from './baskets';

let n = 0;
function lot(over: Partial<BasketLotInfo> = {}): BasketLotInfo {
  n += 1;
  return {
    id: `lot-${n}`,
    lot_number: `L${String(n).padStart(4, '0')}`,
    status: 'RECEIVED',
    received_date: '2026-09-01',
    expected_delivery_date: null,
    is_placeholder: false,
    kg_on_hand: 500,
    bags_released: 10,
    bag_size_kg: 60,
    estimated_days_to_consume: null,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function basket(id: string, name: string): BasketRow {
  return { id, name, is_active: true, notes: null, created_at: '', updated_at: '' };
}

function member(basket_id: string, lot_id: string, active_pct: number | null = null): BasketLotRow {
  return { id: `${basket_id}:${lot_id}`, basket_id, lot_id, active_pct, created_at: '' };
}

describe('lot classification', () => {
  it('treats anything not EN_ROUTE, or with a received date, as in store', () => {
    expect(isLotReceived({ status: 'RECEIVED', received_date: null })).toBe(true);
    expect(isLotReceived({ status: 'COSTING_INCOMPLETE', received_date: null })).toBe(true);
    expect(isLotReceived({ status: 'EN_ROUTE', received_date: '2026-10-01' })).toBe(true);
    expect(isLotReceived({ status: 'EN_ROUTE', received_date: null })).toBe(false);
  });

  it('splits not-received lots into contracted and planned by the placeholder flag', () => {
    expect(lotSupplyGroup(lot({ status: 'EN_ROUTE', received_date: null }))).toBe('CONTRACTED');
    expect(lotSupplyGroup(lot({ status: 'EN_ROUTE', received_date: null, is_placeholder: true }))).toBe('PLANNED');
    // A placeholder that has arrived is in store.
    expect(lotSupplyGroup(lot({ is_placeholder: true }))).toBe('IN_STORE');
  });
});

describe('lined-up sort', () => {
  it('orders in store (oldest received first), then contracted, then planned', () => {
    const planned = lot({ status: 'EN_ROUTE', received_date: null, is_placeholder: true });
    const contractedLate = lot({ status: 'EN_ROUTE', received_date: null, expected_delivery_date: '2026-12-01' });
    const contractedSoon = lot({ status: 'EN_ROUTE', received_date: null, expected_delivery_date: '2026-11-01' });
    const newer = lot({ received_date: '2026-10-01' });
    const older = lot({ received_date: '2026-06-01' });
    const sorted = [planned, contractedLate, newer, contractedSoon, older].sort(compareLinedUp);
    expect(sorted.map(l => l.id)).toEqual([older.id, newer.id, contractedSoon.id, contractedLate.id, planned.id]);
  });
});

describe('percentages', () => {
  it('flags active totals that are not 100, but not an empty basket', () => {
    expect(activePctIsOff([])).toBe(false);
    expect(activePctIsOff([{ active_pct: 60 }, { active_pct: 40 }])).toBe(false);
    expect(activePctIsOff([{ active_pct: 60 }, { active_pct: 30 }])).toBe(true);
    expect(activePctIsOff([{ active_pct: 33.33 }, { active_pct: 33.33 }, { active_pct: 33.34 }])).toBe(false);
    expect(activePctTotal([{ active_pct: 50 }, { active_pct: null }])).toBe(50);
  });

  it('promotes with whatever is left of 100, never negative', () => {
    expect(defaultPromotePct([])).toBe(100);
    expect(defaultPromotePct([{ active_pct: 70 }])).toBe(30);
    expect(defaultPromotePct([{ active_pct: 120 }])).toBe(0);
  });
});

describe('running low', () => {
  const now = new Date('2026-10-21T12:00:00');
  it('uses the 10 kg depletion threshold', () => {
    expect(isLotRunningLow(lot({ kg_on_hand: 10 }), now)).toBe(true);
    expect(isLotRunningLow(lot({ kg_on_hand: 11 }), now)).toBe(false);
  });
  it('uses the under-5-days estimate warning', () => {
    // received Oct 1 + 23 days → Oct 24: 3 days left
    expect(isLotRunningLow(lot({ received_date: '2026-10-01', estimated_days_to_consume: 23 }), now)).toBe(true);
    expect(isLotRunningLow(lot({ received_date: '2026-10-01', estimated_days_to_consume: 60 }), now)).toBe(false);
  });
  it('never flags lots that have not arrived', () => {
    expect(isLotRunningLow(lot({ status: 'EN_ROUTE', received_date: null, kg_on_hand: 0 }), now)).toBe(false);
  });
});

describe('volumes', () => {
  it('sums kg on hand in store and bags × size for contracted lots, ignoring placeholders', () => {
    const v = computeVolumes([
      lot({ kg_on_hand: 300 }),
      lot({ status: 'EN_ROUTE', received_date: null, kg_on_hand: 0, bags_released: 5, bag_size_kg: 69 }),
      lot({ status: 'EN_ROUTE', received_date: null, kg_on_hand: 0, is_placeholder: true, bags_released: 100 }),
    ]);
    expect(v).toEqual({ kgInStore: 300, kgContracted: 345 });
  });

  it('counts a shared lot once in a combined total', () => {
    const shared = lot({ kg_on_hand: 200 });
    const other = lot({ kg_on_hand: 100 });
    expect(computeVolumes([shared, other, shared]).kgInStore).toBe(300);
  });
});

describe('buildBasketView', () => {
  it('groups members, flags use-first, shared, low stock and next up', () => {
    const brazil = basket('b1', 'Brazil');
    const natural = basket('b2', 'Natural');
    const lowActive = lot({ kg_on_hand: 5 });
    const sharedOld = lot({ received_date: '2026-03-01' });
    const fresh = lot({ received_date: '2026-09-15' });
    const coming = lot({ status: 'EN_ROUTE', received_date: null });
    const lots = [lowActive, sharedOld, fresh, coming];
    const members = [
      member('b1', lowActive.id, 60),
      member('b1', coming.id),
      member('b1', fresh.id),
      member('b1', sharedOld.id),
      member('b2', sharedOld.id, 100),
    ];
    const view = buildBasketView(
      brazil,
      members,
      new Map(lots.map(l => [l.id, l])),
      new Map([[brazil.id, brazil], [natural.id, natural]]),
      new Date('2026-10-21T12:00:00'),
    );
    expect(view.active.map(v => v.lot.id)).toEqual([lowActive.id]);
    expect(view.linedUp.map(v => v.lot.id)).toEqual([sharedOld.id, fresh.id, coming.id]);
    expect(view.linedUp[0].useFirst).toBe(true);
    expect(view.linedUp[1].useFirst).toBe(false);
    expect(view.linedUp[0].sharedWith).toEqual(['Natural']);
    expect(view.pctOff).toBe(true);
    expect(view.lowActive.map(v => v.lot.id)).toEqual([lowActive.id]);
    expect(view.nextUp?.lot.id).toBe(sharedOld.id);
    expect(view.volumes.kgInStore).toBe(5 + 500 + 500);
  });
});

describe('originCodeFromText', () => {
  it('accepts codes and names, otherwise null', () => {
    expect(originCodeFromText('eth')).toBe('ETH');
    expect(originCodeFromText('Guatemala')).toBe('GTM');
    expect(originCodeFromText('Washed Ethiopia Guji')).toBe('ETH');
    expect(originCodeFromText('Atlantis')).toBeNull();
    expect(originCodeFromText(null)).toBeNull();
  });
});
