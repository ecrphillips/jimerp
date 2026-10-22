import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { compareLinedUp, isLotReceived, type BasketLotInfo } from '@/lib/baskets';

/**
 * The green lots a roast group reaches through its baskets
 * (roast_group_baskets → basket_lots → green_lots), for production screens:
 * the batch lot picker, green available, and depletion warnings.
 */

const SELECT = `
  id, roast_group, pct,
  baskets (
    id, name,
    basket_lots (
      active_pct, created_at,
      green_lots ( id, lot_number, kg_on_hand, status, received_date, expected_delivery_date,
                   is_placeholder, bags_released, bag_size_kg, estimated_days_to_consume, created_at )
    )
  )
`;

export interface RoastGroupBasketLots {
  /** roast_group_baskets.id */
  rgbId: string;
  roastGroup: string;
  basket: { id: string; name: string };
  /** Share of the roast group from this basket (null = not set). */
  rgPct: number | null;
  /** Active lots, highest % first. */
  active: { lot: BasketLotInfo; activePct: number }[];
  /** Lined-up lots in automatic order (in store, contracted, planned). */
  linedUp: BasketLotInfo[];
}

interface Raw {
  id: string;
  roast_group: string;
  pct: number | null;
  baskets: {
    id: string;
    name: string;
    basket_lots: { active_pct: number | null; created_at: string; green_lots: BasketLotInfo | null }[] | null;
  } | null;
}

/** Pass roast group keys, or omit to load every roast group's baskets. */
export async function fetchRoastGroupBasketLots(roastGroups?: string[]): Promise<RoastGroupBasketLots[]> {
  if (roastGroups && roastGroups.length === 0) return [];
  let q = supabase.from('roast_group_baskets').select(SELECT);
  if (roastGroups) q = q.in('roast_group', roastGroups);
  const { data, error } = await q;
  // Before the baskets migration is live the table is missing: no basket lots.
  if (error) return [];
  return ((data ?? []) as unknown as Raw[])
    .filter(r => r.baskets)
    .map(r => {
      const members = (r.baskets!.basket_lots ?? []).filter(m => m.green_lots);
      return {
        rgbId: r.id,
        roastGroup: r.roast_group,
        basket: { id: r.baskets!.id, name: r.baskets!.name },
        rgPct: r.pct == null ? null : Number(r.pct),
        active: members
          .filter(m => m.active_pct != null)
          .map(m => ({ lot: m.green_lots!, activePct: Number(m.active_pct) }))
          .sort((a, b) => b.activePct - a.activePct || compareLinedUp(a.lot, b.lot)),
        linedUp: members.filter(m => m.active_pct == null).map(m => m.green_lots!).sort(compareLinedUp),
      };
    });
}

export function useRoastGroupBasketLots(roastGroup: string | null | undefined) {
  return useQuery({
    queryKey: ['roast-group-basket-lots', roastGroup ?? ''],
    enabled: !!roastGroup,
    queryFn: () => fetchRoastGroupBasketLots([roastGroup!]),
    staleTime: 30_000,
  });
}

/**
 * Lots from baskets that can be roasted now: every active lot, then lined-up
 * lots already in store. Each lot once (first basket wins), skipping lots in
 * `excludeLotIds` (e.g. ones directly linked).
 */
export function pickableBasketLots(
  baskets: RoastGroupBasketLots[],
  excludeLotIds: Set<string> = new Set(),
): { lot: BasketLotInfo; basketName: string; active: boolean }[] {
  const seen = new Set(excludeLotIds);
  const out: { lot: BasketLotInfo; basketName: string; active: boolean }[] = [];
  for (const b of baskets) {
    for (const a of b.active) {
      if (seen.has(a.lot.id)) continue;
      seen.add(a.lot.id);
      out.push({ lot: a.lot, basketName: b.basket.name, active: true });
    }
  }
  for (const b of baskets) {
    for (const l of b.linedUp) {
      if (seen.has(l.id) || !isLotReceived(l)) continue;
      seen.add(l.id);
      out.push({ lot: l, basketName: b.basket.name, active: false });
    }
  }
  return out;
}

/**
 * Share (0..100) of the roast group's green that comes from one active basket
 * lot: the basket's share (100 when not set) × the lot's share of the basket.
 */
export function basketLotShareOfRoastGroup(rgPct: number | null, activePct: number): number {
  return ((rgPct ?? 100) * activePct) / 100;
}
