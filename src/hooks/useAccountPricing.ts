import { useQuery } from '@tanstack/react-query';
import {
  resolveAccountPricing,
  resolveAccountPricingBatch,
  type ResolvedAccountPricing,
} from '@/lib/coroastPricing';

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
