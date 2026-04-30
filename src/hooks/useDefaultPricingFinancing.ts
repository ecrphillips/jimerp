import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DefaultPricingFinancing {
  financing_days: number;
  financing_apr_pct: number;
  /** True when values come from the default profile in the DB. False when the
   *  lookup failed and we are using the legacy hardcoded fallback. */
  isFromDefaultProfile: boolean;
}

const FALLBACK: DefaultPricingFinancing = {
  financing_days: 60,
  financing_apr_pct: 12,
  isFromDefaultProfile: false,
};

export function useDefaultPricingFinancing() {
  return useQuery<DefaultPricingFinancing>({
    queryKey: ['default_pricing_financing'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: profile, error: pErr } = await supabase
        .from('pricing_rule_profiles')
        .select('id')
        .eq('is_default', true)
        .maybeSingle();
      if (pErr || !profile) return FALLBACK;

      const { data: rules, error: rErr } = await supabase
        .from('pricing_rules')
        .select('financing_days, financing_apr_pct')
        .eq('profile_id', profile.id)
        .maybeSingle();
      if (rErr || !rules) return FALLBACK;

      return {
        financing_days: Number(rules.financing_days ?? 60),
        financing_apr_pct: Number(rules.financing_apr_pct ?? 12),
        isFromDefaultProfile: true,
      };
    },
  });
}
