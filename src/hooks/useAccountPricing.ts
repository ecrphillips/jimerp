import { useQuery } from '@tanstack/react-query';
import {
  resolveAccountPricing,
  resolveAccountPricingBatch,
  fetchGlobalTierRates,
  type GlobalTierRates,
  type ResolvedAccountPricing,
} from '@/lib/coroastPricing';

/**
 * Master co-roast tier rates (from the Co-Roasting Pricing admin page).
 * These are the defaults every account inherits unless it has an override.
 */
export function useGlobalTierRates() {
  return useQuery<GlobalTierRates>({
    queryKey: ['coroast-global-tier-rates'],
    queryFn: fetchGlobalTierRates,
    staleTime: 60 * 1000,
  });
}


export function useAccountPricing(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['coroast-resolved-pricing', accountId],
    queryFn: () => resolveAccountPricing(accountId!),
    enabled: !!accountId,
  });
}

export function useAccountsPricing(accountIds: string[]) {
  const sortedKey = [...accountIds].sort().join(',');
  return useQuery({
    queryKey: ['coroast-resolved-pricing-batch', sortedKey],
    queryFn: () => resolveAccountPricingBatch(accountIds),
    enabled: accountIds.length > 0,
  });
}

export type { ResolvedAccountPricing };
