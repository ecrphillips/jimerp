import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AccountRetailProduct {
  productId: string;            // synthetic id when sourced from a manual scenario
  productName: string;
  bagSizeG: number;
  unitPrice: number;            // retail price per bag, sourced from My Numbers
  pricePerG: number;
  effectiveDate: string;
  source: 'scenario';
  scenarioId: string;
  scenarioName: string;
}

interface ScenarioRow {
  id: string;
  name: string;
  updated_at: string;
  inputs: {
    productId?: string | null;
    productName?: string | null;
    bagSizeG?: number | null;
    retailPrice?: number | null;
  } | null;
}

/**
 * For the given account, return one comparable retail price per product, sourced from the
 * client's own My Numbers scenarios (their target retail price + bag size). Home Island ->
 * client wholesale pricing is out of scope for this build, so we deliberately do NOT pull
 * from `price_list`, which is still seeded at 0.00.
 *
 * Strategy:
 *   - Pull all scenarios for the account with a positive retailPrice and bagSizeG.
 *   - For each productId, keep the most recently updated scenario.
 *   - Scenarios without a productId are still surfaced (labeled by scenario name) so
 *     a client can compare a manual retail price.
 */
export function useAccountRetailPrices(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['account-retail-prices', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountRetailProduct[]> => {
      if (!accountId) return [];

      const { data, error } = await supabase
        .from('client_unit_economics_scenarios')
        .select('id, name, updated_at, inputs')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as unknown as ScenarioRow[];
      const byKey = new Map<string, AccountRetailProduct>();

      for (const s of rows) {
        const i = s.inputs ?? {};
        const bag = Number(i.bagSizeG ?? 0);
        const retail = Number(i.retailPrice ?? 0);
        if (!bag || bag <= 0 || !retail || retail <= 0) continue;

        const key = i.productId ?? `scenario:${s.id}`;
        if (byKey.has(key)) continue; // newest wins (we ordered desc)

        const name = (i.productName?.trim() || s.name?.trim() || 'Untitled').toString();
        byKey.set(key, {
          productId: key,
          productName: name,
          bagSizeG: bag,
          unitPrice: retail,
          pricePerG: retail / bag,
          effectiveDate: s.updated_at,
          source: 'scenario',
          scenarioId: s.id,
          scenarioName: s.name,
        });
      }

      return Array.from(byKey.values()).sort((a, b) => b.pricePerG - a.pricePerG);
    },
  });
}
