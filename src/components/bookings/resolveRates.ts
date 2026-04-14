import { supabase } from '@/integrations/supabase/client';
import { TIER_RATES, STORAGE_RATES } from './bookingUtils';

const SETTINGS_KEY = 'coroast_tier_rates';

interface ResolvedRates {
  base: number;
  includedHours: number;
  overageRate: number;
  includedPallets: number;
  storageRate: number;
}

/**
 * Resolve billing rates for an account, checking in order:
 * 1. Per-account custom overrides on the accounts row
 * 2. Global app_settings 'coroast_tier_rates'
 * 3. Hardcoded TIER_RATES / STORAGE_RATES fallback constants
 */
export async function resolveAccountRates(accountId: string, tier: string): Promise<ResolvedRates> {
  // 1. Fetch account overrides
  const { data: account } = await supabase
    .from('accounts')
    .select('coroast_custom_base_fee, coroast_custom_included_hours, coroast_custom_overage_rate, coroast_custom_included_pallets, coroast_custom_storage_rate')
    .eq('id', accountId)
    .maybeSingle();

  // 2. Fetch app_settings global rates
  const { data: settings } = await supabase
    .from('app_settings')
    .select('value_json')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  const globalTierRates = settings?.value_json
    ? (settings.value_json as Record<string, any>)[tier]
    : null;

  // 3. Fallback constants
  const fallbackRates = TIER_RATES[tier] ?? TIER_RATES.MEMBER;
  const fallbackStorage = STORAGE_RATES[tier] ?? STORAGE_RATES.MEMBER;

  return {
    base: (account as any)?.coroast_custom_base_fee ?? globalTierRates?.base ?? fallbackRates.base,
    includedHours: (account as any)?.coroast_custom_included_hours ?? globalTierRates?.includedHours ?? fallbackRates.includedHours,
    overageRate: (account as any)?.coroast_custom_overage_rate ?? globalTierRates?.overageRate ?? fallbackRates.overageRate,
    includedPallets: (account as any)?.coroast_custom_included_pallets ?? globalTierRates?.includedPallets ?? fallbackStorage.includedPallets,
    storageRate: (account as any)?.coroast_custom_storage_rate ?? globalTierRates?.storageRate ?? fallbackStorage.ratePerPallet,
  };
}
