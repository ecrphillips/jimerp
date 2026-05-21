/**
 * Resolve the weighted green market value ($/kg) for a roast group, by reading
 * its linked green lots (green_lot_roast_group_links → green_lots).
 *
 * Weighted by pct_of_lot when set; otherwise equal weights across linked lots.
 * Falls back to null when no usable book value exists — the caller is expected
 * to show a placeholder in that case.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type RoastGroupGreenValue = {
  marketValuePerKg: number | null;
  bookValuePerKg: number | null;
  source: 'lots' | 'placeholder';
  lotCount: number;
};

export function useRoastGroupGreenValue(roastGroupKey: string | null | undefined) {
  return useQuery({
    queryKey: ['roast-group-green-value', roastGroupKey ?? ''],
    enabled: !!roastGroupKey,
    queryFn: async (): Promise<RoastGroupGreenValue> => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select(`
          pct_of_lot,
          green_lots!green_lot_roast_group_links_lot_id_fkey (
            id, book_value_per_kg, market_value_per_kg
          )
        `)
        .eq('roast_group', roastGroupKey!);
      if (error) throw error;

      const rows = (data ?? []).filter((r: any) => r.green_lots);
      if (rows.length === 0) {
        return { marketValuePerKg: null, bookValuePerKg: null, source: 'placeholder', lotCount: 0 };
      }

      const usable = rows.filter((r: any) => {
        const v = r.green_lots?.market_value_per_kg ?? r.green_lots?.book_value_per_kg;
        return v != null && Number(v) > 0;
      });
      if (usable.length === 0) {
        return { marketValuePerKg: null, bookValuePerKg: null, source: 'placeholder', lotCount: rows.length };
      }

      const totalPct = usable.reduce((a: number, r: any) => a + (Number(r.pct_of_lot) || 0), 0);
      const useEqual = totalPct <= 0;

      let market = 0;
      let book = 0;
      const w = (r: any) => (useEqual ? 1 / usable.length : (Number(r.pct_of_lot) || 0) / totalPct);
      for (const r of usable) {
        const lot = r.green_lots;
        const mv = lot.market_value_per_kg != null ? Number(lot.market_value_per_kg) : Number(lot.book_value_per_kg);
        const bv = Number(lot.book_value_per_kg ?? mv);
        market += w(r) * mv;
        book += w(r) * bv;
      }
      return {
        marketValuePerKg: market,
        bookValuePerKg: book,
        source: 'lots',
        lotCount: usable.length,
      };
    },
    staleTime: 30_000,
  });
}
