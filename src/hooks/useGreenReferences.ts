import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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

interface LinkRow {
  roast_group: string;
  pct_of_lot: number | null;
  green_lots: {
    id: string;
    book_value_per_kg: number | null;
    market_value_per_kg: number | null;
  } | null;
}

/** Weighted by pct_of_lot when present, equal weights otherwise. */
function weightedValue(rows: LinkRow[], pick: (l: NonNullable<LinkRow['green_lots']>) => number | null) {
  const usable = rows.filter((r) => {
    if (!r.green_lots) return false;
    const v = pick(r.green_lots);
    return v != null && Number(v) > 0;
  });
  if (usable.length === 0) return null;

  const totalPct = usable.reduce((a, r) => a + (Number(r.pct_of_lot) || 0), 0);
  const equal = totalPct <= 0;

  let acc = 0;
  for (const r of usable) {
    const w = equal ? 1 / usable.length : (Number(r.pct_of_lot) || 0) / totalPct;
    acc += w * Number(pick(r.green_lots!));
  }
  return acc;
}

export function useGreenReferences() {
  return useQuery({
    queryKey: ['green-references'],
    staleTime: 30_000,
    queryFn: async (): Promise<GreenReference[]> => {
      const [linksResp, lotsResp, groupsResp] = await Promise.all([
        supabase.from('green_lot_roast_group_links').select(`
          roast_group,
          pct_of_lot,
          green_lots!green_lot_roast_group_links_lot_id_fkey (
            id, book_value_per_kg, market_value_per_kg
          )
        `),
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

      const links = (linksResp.data ?? []) as unknown as LinkRow[];
      const byGroup = new Map<string, LinkRow[]>();
      for (const l of links) {
        if (!byGroup.has(l.roast_group)) byGroup.set(l.roast_group, []);
        byGroup.get(l.roast_group)!.push(l);
      }

      const groups: GreenReference[] = (groupsResp.data ?? [])
        .map((g) => {
          const rows = byGroup.get(g.roast_group) ?? [];
          const market = weightedValue(rows, (l) => l.market_value_per_kg ?? l.book_value_per_kg);
          const book = weightedValue(rows, (l) => l.book_value_per_kg ?? l.market_value_per_kg);
          return {
            kind: 'ROAST_GROUP' as const,
            id: g.roast_group,
            label: g.display_name || g.roast_group,
            sublabel:
              rows.length === 0
                ? 'No linked lots'
                : `${rows.length} lot${rows.length === 1 ? '' : 's'}, weighted`,
            marketPerKg: market,
            bookPerKg: book,
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
