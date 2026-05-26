import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import type { Database } from '@/integrations/supabase/types';

export type AccountStatus = Database['public']['Enums']['account_status'];
export type CoroastTier = Database['public']['Enums']['coroast_tier'];

export interface IsProspectResult {
  isProspect: boolean;
  accountStatus: AccountStatus | null;
  selectedTier: CoroastTier | null;
  accountId: string | null;
  isLoading: boolean;
}

export function useIsProspect(): IsProspectResult {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const accountId = previewAccountId ?? authUser?.accountId ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ['account-status', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from('accounts')
        .select('account_status, prospect_selected_tier')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const accountStatus = (data?.account_status ?? null) as AccountStatus | null;
  const selectedTier = (data?.prospect_selected_tier ?? null) as CoroastTier | null;

  return {
    isProspect: accountStatus === 'PROSPECT',
    accountStatus,
    selectedTier,
    accountId,
    isLoading,
  };
}
