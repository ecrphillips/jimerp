import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { roastGroupGreenValue } from '@/lib/greenSources';
import {
  LINK_PRICED_SELECT,
  ROAST_GROUP_BASKET_PRICED_SELECT,
  toLinkPriced,
  toRoastGroupBasketPriced,
  type RawLink,
  type RawRoastGroupBasket,
} from '@/lib/greenSourceQueries';

/**
 * Green price reference points, for sanity-checking a benchmark before setting it.
 *
 * Pricing a product means picking a benchmark with headroom over what the coffee
 * actually costs. That judgement needs the real numbers in front of you — which
 * otherwise means opening another tab and navigating away mid-quote.
 */
export interface GreenReference {
  kind: 'ROAST_GROUP' | 'LOT';
  id: string;
  label: string;
  sublabel: string;
  /** Market / replacement value — the number a benchmark should clear. */
  marketPerKg: number | null;
  /** Landed book value, shown for contrast. */
  bookPerKg: number | null;
}

export function useGreenReferences() {
  return useQuery({
    queryKey: ['green-references'],
    staleTime: 30_000,
    queryFn: async (): Promise<GreenReference[]> => {
      const [linksResp, basketsResp, lotsResp, groupsResp] = await Promise.all([
        supabase.from('green_lot_roast_group_links').select(LINK_PRICED_SELECT),
        supabase.from('roast_group_baskets').select(ROAST_GROUP_BASKET_PRICED_SELECT),
        supabase
          .from('green_lots')
          .select('id, lot_number, lot_identifier, book_value_per_kg, market_value_per_kg, kg_on_hand, status')
          .order('lot_number'),
        supabase
          .from('roast_groups')
          .select('roast_group, display_name, is_active')
          .eq('is_active', true),
      ]);

      if (linksResp.error) throw linksResp.error;
      if (lotsResp.error) throw lotsResp.error;
      if (groupsResp.error) throw groupsResp.error;

      const links = ((linksResp.data ?? []) as unknown as RawLink[]).map(toLinkPriced);
      // Before the baskets migration is live this table is missing; treat as "no baskets".
      const rgBaskets = (basketsResp.error ? [] : ((basketsResp.data ?? []) as unknown as RawRoastGroupBasket[]))
        .map(toRoastGroupBasketPriced);

      const groups: GreenReference[] = (groupsResp.data ?? [])
        .map((g) => {
          const myLinks = links.filter(l => l.roast_group === g.roast_group);
          const myBaskets = rgBaskets.filter(b => b.roast_group === g.roast_group);
          const v = roastGroupGreenValue(myLinks, myBaskets);
          const parts: string[] = [];
          for (const b of myBaskets) if (b.basket) parts.push(`${b.basket.name} basket`);
          const lotN = myLinks.filter(l => l.lot).length;
          if (lotN > 0) parts.push(`${lotN} lot${lotN === 1 ? '' : 's'}`);
          return {
            kind: 'ROAST_GROUP' as const,
            id: g.roast_group,
            label: g.display_name || g.roast_group,
            sublabel: parts.length === 0 ? 'No green sources' : `${parts.join(' + ')}, weighted`,
            marketPerKg: v.marketPerKg,
            bookPerKg: v.bookPerKg,
          };
        })
        // A group with no priced lots is not a reference point.
        .filter((g) => g.marketPerKg != null);

      const lots: GreenReference[] = (lotsResp.data ?? [])
        .map((l) => ({
          kind: 'LOT' as const,
          id: l.id,
          label: l.lot_identifier || l.lot_number,
          sublabel: `${Number(l.kg_on_hand ?? 0).toFixed(0)} kg on hand · ${l.status}`,
          marketPerKg:
            l.market_value_per_kg != null ? Number(l.market_value_per_kg) : l.book_value_per_kg != null ? Number(l.book_value_per_kg) : null,
          bookPerKg: l.book_value_per_kg != null ? Number(l.book_value_per_kg) : null,
        }))
        .filter((l) => l.marketPerKg != null);

      return [...groups, ...lots];
    },
  });
}
