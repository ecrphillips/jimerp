import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AccountRetailProduct {
  productId: string;
  productName: string;
  bagSizeG: number;
  unitPrice: number;        // latest effective_date entry
  pricePerG: number;
  effectiveDate: string;
}

/**
 * For the given account, return each active product's latest unit_price from price_list,
 * already normalized to $/g for direct comparison against the market audit distribution.
 */
export function useAccountRetailPrices(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['account-retail-prices', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountRetailProduct[]> => {
      if (!accountId) return [];

      const { data: products, error: pErr } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g, is_active, account_id')
        .eq('account_id', accountId)
        .eq('is_active', true);
      if (pErr) throw pErr;
      const list = products ?? [];
      if (list.length === 0) return [];

      const productIds = list.map(p => p.id);
      const { data: prices, error: prErr } = await supabase
        .from('price_list')
        .select('id, product_id, unit_price, effective_date')
        .in('product_id', productIds)
        .order('effective_date', { ascending: false });
      if (prErr) throw prErr;

      // Pick the newest price per product
      const latest = new Map<string, { unit_price: number; effective_date: string }>();
      for (const row of prices ?? []) {
        if (!latest.has(row.product_id)) {
          latest.set(row.product_id, {
            unit_price: Number(row.unit_price),
            effective_date: row.effective_date,
          });
        }
      }

      const out: AccountRetailProduct[] = [];
      for (const p of list) {
        const price = latest.get(p.id);
        if (!price || !p.bag_size_g || p.bag_size_g <= 0) continue;
        out.push({
          productId: p.id,
          productName: p.product_name,
          bagSizeG: p.bag_size_g,
          unitPrice: price.unit_price,
          pricePerG: price.unit_price / p.bag_size_g,
          effectiveDate: price.effective_date,
        });
      }
      // sort highest $/g first so the user sees premium products first
      out.sort((a, b) => b.pricePerG - a.pricePerG);
      return out;
    },
  });
}
