import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ClientProductPrefill {
  productId: string;
  productName: string;
  bagSizeG: number;
  bagsShipped90d: number;
  kgShipped90d: number;
  avgPricePerBag: number;
}

export interface ClientPrefills {
  /** Trailing 3-month average kg/month shipped to this account. */
  currentPaceKgPerMonth: number;
  /** Same quarter last year (kg averaged across same calendar 90-day window 1y ago), if available. */
  seasonalPaceKgPerMonth: number | null;
  /** True when seasonal data should be the default pre-fill. */
  preferSeasonal: boolean;
  /** Per-product summary, sorted by most-shipped first. */
  products: ClientProductPrefill[];
  /** Top product id (largest kg shipped in last 90 days), if any. */
  defaultProductId: string | null;
}

interface OrderRow {
  id: string;
  account_id: string | null;
  status: string;
  created_at: string;
}

interface LineRow {
  order_id: string;
  product_id: string;
  shipped_quantity: number | null;
  quantity_units: number;
  unit_price_locked: number;
  product: { product_name: string | null; bag_size_g: number | null } | null;
}

function daysBack(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function isCurrentlyInSeasonalShoulder(): boolean {
  // Café shoulder seasons: within 30 days of Mar/Apr or Sep/Oct transitions.
  const now = new Date();
  const month = now.getUTCMonth(); // 0-indexed
  // Treat Feb-Apr and Aug-Oct as shoulder windows.
  return month === 1 || month === 2 || month === 3 || month === 7 || month === 8 || month === 9;
}

async function fetchShippedForWindow(accountId: string, startISO: string, endISO: string) {
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('id, account_id, status, created_at')
    .eq('account_id', accountId)
    .eq('status', 'SHIPPED')
    .gte('created_at', startISO)
    .lte('created_at', endISO);
  if (oErr) throw oErr;
  const orderIds = (orders ?? []).map((o: OrderRow) => o.id);
  if (orderIds.length === 0) return [] as LineRow[];

  const { data: lines, error: lErr } = await supabase
    .from('order_line_items')
    .select('order_id, product_id, shipped_quantity, quantity_units, unit_price_locked, product:products(product_name, bag_size_g)')
    .in('order_id', orderIds);
  if (lErr) throw lErr;
  return (lines ?? []) as unknown as LineRow[];
}

export function useClientPrefills(accountId: string | null) {
  return useQuery({
    queryKey: ['client-ue-prefills', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<ClientPrefills> => {
      if (!accountId) {
        return { currentPaceKgPerMonth: 0, seasonalPaceKgPerMonth: null, preferSeasonal: false, products: [], defaultProductId: null };
      }

      const now = new Date();
      const start90 = daysBack(90);
      const yearAgoEnd = new Date(now); yearAgoEnd.setUTCFullYear(yearAgoEnd.getUTCFullYear() - 1);
      const yearAgoStart = new Date(yearAgoEnd); yearAgoStart.setUTCDate(yearAgoStart.getUTCDate() - 90);

      const [recent, yearAgo] = await Promise.all([
        fetchShippedForWindow(accountId, start90, now.toISOString()),
        fetchShippedForWindow(accountId, yearAgoStart.toISOString(), yearAgoEnd.toISOString()),
      ]);

      const productAgg = new Map<string, { name: string; bagSizeG: number; bags: number; kg: number; revenue: number }>();
      let totalKg90 = 0;
      for (const l of recent) {
        const qty = l.shipped_quantity ?? l.quantity_units ?? 0;
        if (qty <= 0) continue;
        const bagG = l.product?.bag_size_g ?? 340;
        const kg = (qty * bagG) / 1000;
        totalKg90 += kg;
        const cur = productAgg.get(l.product_id) ?? {
          name: l.product?.product_name ?? 'Product',
          bagSizeG: bagG,
          bags: 0, kg: 0, revenue: 0,
        };
        cur.bags += qty;
        cur.kg += kg;
        cur.revenue += qty * (l.unit_price_locked ?? 0);
        productAgg.set(l.product_id, cur);
      }

      let totalKgYearAgo = 0;
      for (const l of yearAgo) {
        const qty = l.shipped_quantity ?? l.quantity_units ?? 0;
        if (qty <= 0) continue;
        const bagG = l.product?.bag_size_g ?? 340;
        totalKgYearAgo += (qty * bagG) / 1000;
      }

      const products: ClientProductPrefill[] = Array.from(productAgg.entries())
        .map(([productId, v]) => ({
          productId,
          productName: v.name,
          bagSizeG: v.bagSizeG,
          bagsShipped90d: v.bags,
          kgShipped90d: v.kg,
          avgPricePerBag: v.bags > 0 ? v.revenue / v.bags : 0,
        }))
        .sort((a, b) => b.kgShipped90d - a.kgShipped90d);

      const seasonalKgPerMonth = yearAgo.length > 0 ? totalKgYearAgo / 3 : null;
      const preferSeasonal = seasonalKgPerMonth != null && isCurrentlyInSeasonalShoulder();

      return {
        currentPaceKgPerMonth: totalKg90 / 3,
        seasonalPaceKgPerMonth: seasonalKgPerMonth,
        preferSeasonal,
        products,
        defaultProductId: products[0]?.productId ?? null,
      };
    },
  });
}
