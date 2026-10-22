/**
 * Resolve the weighted green market value ($/kg) for a roast group from its
 * green sources: linked lots (green_lot_roast_group_links) and baskets
 * (roast_group_baskets → the basket's active lots).
 *
 * Weighted by % when set; otherwise equal weights across sources. A basket's
 * own value is its active lots weighted by their active %. Falls back to null
 * when no usable value exists — the caller shows a placeholder in that case.
 * `lines` carries the full breakdown so the number is never a black box.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { roastGroupGreenValue, type GreenSourceLine } from '@/lib/greenSources';
import {
  LINK_PRICED_SELECT,
  ROAST_GROUP_BASKET_PRICED_SELECT,
  toLinkPriced,
  toRoastGroupBasketPriced,
  type RawLink,
  type RawRoastGroupBasket,
} from '@/lib/greenSourceQueries';

export type RoastGroupGreenValue = {
  marketValuePerKg: number | null;
  bookValuePerKg: number | null;
  source: 'lots' | 'placeholder';
  /** Number of priced sources (lots and baskets) in the average. */
  lotCount: number;
  lines: (GreenSourceLine & { weight: number })[];
};

export function useRoastGroupGreenValue(roastGroupKey: string | null | undefined) {
  return useQuery({
    queryKey: ['roast-group-green-value', roastGroupKey ?? ''],
    enabled: !!roastGroupKey,
    queryFn: async (): Promise<RoastGroupGreenValue> => {
      const [linksResp, basketsResp] = await Promise.all([
        supabase.from('green_lot_roast_group_links').select(LINK_PRICED_SELECT).eq('roast_group', roastGroupKey!),
        supabase.from('roast_group_baskets').select(ROAST_GROUP_BASKET_PRICED_SELECT).eq('roast_group', roastGroupKey!),
      ]);
      if (linksResp.error) throw linksResp.error;
      // Before the baskets migration is live this table is missing; treat as "no baskets".
      const basketRows = basketsResp.error ? [] : ((basketsResp.data ?? []) as unknown as RawRoastGroupBasket[]);

      const v = roastGroupGreenValue(
        ((linksResp.data ?? []) as unknown as RawLink[]).map(toLinkPriced),
        basketRows.map(toRoastGroupBasketPriced),
      );
      if (v.marketPerKg == null) {
        return { marketValuePerKg: null, bookValuePerKg: null, source: 'placeholder', lotCount: v.lines.length, lines: v.lines };
      }
      return {
        marketValuePerKg: v.marketPerKg,
        bookValuePerKg: v.bookPerKg,
        source: 'lots',
        lotCount: v.usableCount,
        lines: v.lines,
      };
    },
    staleTime: 30_000,
  });
}
