import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { basketLotShareOfRoastGroup, pickableBasketLots, type RoastGroupBasketLots } from './roastGroupBasketLots';
import { basketDepletionLinks } from './useGreenLotDepletion';
import type { BasketLotInfo } from '@/lib/baskets';

const lot = (id: string, over: Partial<BasketLotInfo> = {}): BasketLotInfo => ({
  id, lot_number: id, status: 'RECEIVED', received_date: '2026-09-01', expected_delivery_date: null,
  is_placeholder: false, kg_on_hand: 300, bags_released: 5, bag_size_kg: 60,
  estimated_days_to_consume: null, created_at: '2026-08-01T00:00:00Z', ...over,
});

const brazil: RoastGroupBasketLots = {
  rgbId: 'rgb1',
  roastGroup: 'MED_DARK',
  basket: { id: 'b1', name: 'Brazil' },
  rgPct: 60,
  active: [{ lot: lot('bra-active'), activePct: 100 }],
  linedUp: [lot('bra-store'), lot('bra-coming', { status: 'EN_ROUTE', received_date: null })],
};

describe('pickableBasketLots', () => {
  it('lists active lots, then lined-up lots already in store, skipping excluded ones', () => {
    expect(pickableBasketLots([brazil]).map(p => p.lot.id)).toEqual(['bra-active', 'bra-store']);
    expect(pickableBasketLots([brazil], new Set(['bra-active'])).map(p => p.lot.id)).toEqual(['bra-store']);
  });
});

describe('basketLotShareOfRoastGroup', () => {
  it('multiplies the basket share by the lot share, treating an unset basket % as 100', () => {
    expect(basketLotShareOfRoastGroup(60, 50)).toBe(30);
    expect(basketLotShareOfRoastGroup(null, 50)).toBe(50);
  });
});

describe('basketDepletionLinks', () => {
  it('turns active basket lots into synthetic links with the next lined-up lot as successor', () => {
    const [link] = basketDepletionLinks([brazil]);
    expect(link.link_id).toBe('basket:rgb1:bra-active');
    expect(link.pct_of_lot).toBe(60);
    expect(link.successor_lot?.id).toBe('bra-store');
    expect(link.basket?.name).toBe('Brazil');
  });
});
