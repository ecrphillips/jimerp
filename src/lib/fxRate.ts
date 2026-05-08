import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Adds a 2-cent buffer to the authoritative Bank of Canada USD→CAD rate
 * and rounds to the nearest 0.01. Used everywhere FX is applied to costs
 * (lots, purchases, releases). The Admin Tools view shows the raw BoC rate.
 *
 * Examples:
 *   1.3686 → 1.39
 *   1.3721 → 1.39
 *   1.3792 → 1.40
 */
export function getEffectiveFxRate(rawRate: number | null | undefined): number | null {
  if (rawRate == null || !Number.isFinite(rawRate) || rawRate <= 0) return null;
  return Math.round((rawRate + 0.02) * 100) / 100;
}

export interface LiveFxRateValue {
  rate: number;
  date: string | null;
  source: string;
  fetched_at: string | null;
}

/**
 * Fetches the live BoC rate from app_settings and returns both the raw
 * authoritative value (for display in Admin Tools) and the buffered
 * effective value (for prefilling cost FX fields).
 */
export function useEffectiveFxRate() {
  const query = useQuery({
    queryKey: ['app_settings', 'fx_rate_usd_to_cad'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', 'fx_rate_usd_to_cad')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const value = query.data?.value_json as unknown as LiveFxRateValue | undefined;
  const rawRate: number | null = value?.rate && Number.isFinite(Number(value.rate)) ? Number(value.rate) : null;
  const effectiveRate = getEffectiveFxRate(rawRate);

  return { rawRate, effectiveRate, isLoading: query.isLoading };
}
