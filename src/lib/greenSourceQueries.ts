import type { BasketMemberPriced, LinkPriced, PricedLot, RoastGroupBasketPriced } from '@/lib/greenSources';

/**
 * PostgREST select strings + row mappers for a roast group's green sources,
 * shared by the pricing hooks so they read the same shape.
 */
export const LINK_PRICED_SELECT = `
  roast_group,
  pct_of_lot,
  green_lots!green_lot_roast_group_links_lot_id_fkey (
    id, lot_number, book_value_per_kg, market_value_per_kg
  )
`;

export const ROAST_GROUP_BASKET_PRICED_SELECT = `
  roast_group,
  pct,
  display_order,
  baskets (
    id, name,
    basket_lots ( active_pct, green_lots ( id, lot_number, book_value_per_kg, market_value_per_kg ) )
  )
`;

interface RawLink {
  roast_group: string;
  pct_of_lot: number | null;
  green_lots: PricedLot | null;
}

interface RawRoastGroupBasket {
  roast_group: string;
  pct: number | null;
  display_order: number;
  baskets: {
    id: string;
    name: string;
    basket_lots: { active_pct: number | null; green_lots: PricedLot | null }[] | null;
  } | null;
}

export function toLinkPriced(r: RawLink): LinkPriced & { roast_group: string } {
  return { roast_group: r.roast_group, pct_of_lot: r.pct_of_lot, lot: r.green_lots };
}

export function toRoastGroupBasketPriced(r: RawRoastGroupBasket): RoastGroupBasketPriced & { roast_group: string } {
  const members: BasketMemberPriced[] = (r.baskets?.basket_lots ?? [])
    .filter(m => m.green_lots)
    .map(m => ({ active_pct: m.active_pct, lot: m.green_lots as PricedLot }));
  return {
    roast_group: r.roast_group,
    pct: r.pct,
    basket: r.baskets ? { id: r.baskets.id, name: r.baskets.name, members } : null,
  };
}

export type { RawLink, RawRoastGroupBasket };
